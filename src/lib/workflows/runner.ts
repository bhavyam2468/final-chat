import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getSettings, type Settings } from "../settings";
import { complete, type OAMsg } from "../llm";
import { firecrawlScrape, firecrawlSearch } from "../web";
import { WS } from "../workspace";
import { normUrl } from "../harness/stream";
import { loadWorkflow } from "./index";
import type { RunEvent, RunState, Source, WorkflowDef } from "./types";

/**
 * The workflow engine.
 *
 * A run is a server-side object with its own event buffer, exactly like an agent run: closing the
 * window, switching chats or reloading only detaches a viewer, and any page can re-attach to the
 * whole history. Every step boundary is also written to workspace/workflows/runs/<id>/run.json, so a
 * run survives a server restart and the window can be reopened from the chat it delivered to.
 *
 * Context isolation is the point of the engine, not a side effect: each page is distilled by its own
 * completion that sees one page and the sub-questions; the writer sees claims and quotes, never a
 * page; only the finished report is written back into the conversation.
 */

type Live = {
  state: RunState;
  def: WorkflowDef;
  listeners: Set<(e: RunEvent) => void>;
  ctrl: AbortController;
  done: boolean;
  /** timers for coalesced disk writes */
  writing: ReturnType<typeof setTimeout> | null;
};

const g = globalThis as unknown as { __wfRuns?: Map<string, Live> };
const runs: Map<string, Live> = (g.__wfRuns ||= new Map());
const MAX_KEPT = 20;
const runDir = (id: string) => path.join(WS, "workflows", "runs", id);

// --------------------------------------------------------------------- helpers

const send = (live: Live, e: RunEvent) => live.listeners.forEach((l) => l(e));

const setStep = (live: Live, id: string, patch: Partial<RunState["steps"][number]>) => {
  const s = live.state.steps.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  send(live, { t: "step", id, patch });
};

/** Close a step, keeping the real duration (the rail shows where the time went). */
const finishStep = (live: Live, id: string, patch: Partial<RunState["steps"][number]> = {}) => {
  const s = live.state.steps.find((x) => x.id === id);
  setStep(live, id, { status: "done", ms: s?.startedAt ? Date.now() - s.startedAt : 0, ...patch });
};

const log = (live: Live, step: string, text: string) => {
  const line = { at: Date.now(), step, text };
  live.state.log.push(line);
  if (live.state.log.length > 600) live.state.log.splice(0, live.state.log.length - 600);
  send(live, { t: "log", line });
};

const writeRun = async (live: Live) => {
  const dir = runDir(live.state.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "run.json"), JSON.stringify(live.state, null, 1));
};

/** Coalesced persistence: a read pass updates the state a dozen times in a second. */
const persist = (live: Live) => {
  if (live.writing) return;
  live.writing = setTimeout(() => { live.writing = null; void writeRun(live).catch(() => {}); }, 300);
};

/** Parse the first complete JSON object in a model reply (prompts ask for JSON only, models still chat). */
function firstJson(text: string): Record<string, unknown> | null {
  const s = (text || "").replace(/```[a-z]*\n?/gi, "");
  const i = s.indexOf("{");
  if (i < 0) return null;
  let depth = 0;
  let str: string | null = null;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (str) { if (c === "\\") k++; else if (c === str) str = null; continue; }
    if (c === '"') str = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (!depth) { try { return JSON.parse(s.slice(i, k + 1)) as Record<string, unknown>; } catch { return null; } }
    }
  }
  return null;
}

const clip = (s: string, n: number) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (let k = i++; k < items.length; k = i++) out[k] = await fn(items[k], k);
  }));
  return out;
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

// --------------------------------------------------------------- the pipeline

/** One isolated completion: its own system prompt, its own inputs, no history. */
async function ask(st: Settings, live: Live, system: string, user: string, max: number): Promise<string> {
  const msgs: OAMsg[] = [{ role: "system", content: system }, { role: "user", content: user }];
  live.state.stats.calls++;
  persist(live);
  return complete(st, msgs, max);
}

async function pipeline(live: Live, st: Settings) {
  const { budget } = live.def;
  const q = live.state.question;
  const stopped = () => live.ctrl.signal.aborted;
  const stop = (status: RunState["status"]) => { live.state.status = status; };

  // ---- plan
  const planStep = live.def.steps.find((s) => s.kind === "plan");
  if (planStep) {
    setStep(live, planStep.id, { status: "running", startedAt: Date.now() });
    log(live, planStep.id, "Breaking the question into parts");
    const raw = await ask(st, live, live.def.prompts.plan, `Question: ${q}\n\nBetween ${budget.sub[0]} and ${budget.sub[1]} sub-questions.`, 900);
    const j = firstJson(raw);
    const list = (Array.isArray(j?.sub) ? j.sub : []) as { q?: unknown; queries?: unknown }[];
    const sub = list.map((x, i) => ({
      id: String(i + 1),
      q: clip(String(x.q || ""), 240),
      queries: (Array.isArray(x.queries) ? x.queries : []).map((s) => clip(String(s), 120)).filter(Boolean).slice(0, 2),
    })).filter((s) => s.q && s.queries.length).slice(0, budget.sub[1]);
    if (!sub.length) {
      // A planner that returns prose still gets a run: fall back to the question itself as the plan.
      sub.push({ id: "1", q: q, queries: [clip(q, 120)] });
      log(live, planStep.id, "The planner did not return sub-questions — searching the question directly");
    }
    live.state.plan = { sub };
    send(live, { t: "plan", plan: live.state.plan });
    finishStep(live, planStep.id, { items: sub.length, note: `${sub.length} sub-questions · ${sub.reduce((a, s) => a + s.queries.length, 0)} queries` });
    persist(live);
  }

  // ---- search: every query of every sub-question, deduplicated by URL
  const searchStep = live.def.steps.find((s) => s.kind === "search");
  const seen = new Set(live.state.sources.map((s) => normUrl(s.url)));
  const addHits = async (step: string, sq: string, query: string): Promise<number> => {
    live.state.stats.queries++;
    const j = await firecrawlSearch(st, query, budget.perQuery).catch(() => ({ data: [] as { url: string; title?: string; description?: string }[] }));
    const rows = (j.data || []) as { url: string; title?: string; description?: string }[];
    let n = 0;
    for (const r of rows) {
      const url = String(r.url || "").trim();
      if (!/^https?:/i.test(url) || seen.has(normUrl(url))) continue;
      seen.add(normUrl(url));
      live.state.sources.push({ id: live.state.sources.length + 1, url, title: clip(String(r.title || url), 160), host: hostOf(url), snippet: clip(String(r.description || ""), 300), sq });
      n++;
    }
    if (!rows.length) log(live, step, `No results for “${query}”${j._source === "none" ? " — search is not configured on this install" : ""}`);
    return n;
  };
  if (searchStep && !stopped()) {
    setStep(live, searchStep.id, { status: "running", startedAt: Date.now() });
    const jobs: { sq: string; query: string }[] = [];
    for (const s of live.state.plan?.sub || []) for (const query of s.queries) jobs.push({ sq: s.id, query });
    await mapLimit(jobs, 3, async (j) => {
      log(live, searchStep.id, `Searching “${j.query}”`);
      await addHits(searchStep.id, j.sq, j.query);
    });
    send(live, { t: "sources", sources: live.state.sources });
    finishStep(live, searchStep.id, { items: live.state.sources.length, note: `${live.state.sources.length} candidates from ${jobs.length} queries` });
    log(live, searchStep.id, `${live.state.sources.length} candidate pages`);
    persist(live);
  }

  // ---- select: which pages are worth opening (the model may only pick URLs that exist)
  const selectStep = live.def.steps.find((s) => s.kind === "select");
  let chosen: Source[] = [];
  if (selectStep && !stopped()) {
    setStep(live, selectStep.id, { status: "running", startedAt: Date.now() });
    const cands = live.state.sources.slice(0, budget.candidates);
    if (cands.length <= budget.reads) {
      chosen = cands;
      finishStep(live, selectStep.id, { items: chosen.length, note: `all ${chosen.length} candidates fit the budget` });
    } else {
      const list = cands.map((s) => `[${s.id}] ${s.title}\n${s.url}\nsq ${s.sq}${s.snippet ? ` · ${s.snippet}` : ""}`).join("\n\n");
      const subText = (live.state.plan?.sub || []).map((s) => `${s.id}. ${s.q}`).join("\n");
      const raw = await ask(st, live, live.def.prompts.select, `Question: ${q}\n\nSub-questions:\n${subText}\n\nCandidates (${cands.length}):\n${list}\n\nPick at most ${budget.reads} pages.`, 1200).catch(() => "");
      const j = firstJson(raw);
      const picks = (Array.isArray(j?.reads) ? j.reads : []) as { url?: unknown; sq?: unknown; why?: unknown }[];
      const byUrl = new Map(cands.map((s) => [normUrl(s.url), s]));
      for (const p of picks) {
        const hit = byUrl.get(normUrl(String(p.url || "")));
        if (!hit || hit.read) continue;
        hit.read = true; // marks "selected"; flipped to a read count after the read pass
        hit.why = clip(String(p.why || ""), 120);
        if (p.sq !== undefined && String(p.sq) !== hit.sq) hit.sq = String(p.sq);
        chosen.push(hit);
        if (chosen.length >= budget.reads) break;
      }
      if (!chosen.length) {
        chosen = cands.slice(0, budget.reads);
        log(live, selectStep.id, "The selector did not return usable pages — reading the first matches instead");
      }
      finishStep(live, selectStep.id, { items: chosen.length, note: `${chosen.length} of ${cands.length} pages chosen` });
    }
    for (const s of chosen) s.read = false; // set again per page, so the window's Sources pane fills in live
    persist(live);
  }

  // ---- read: one isolated pass per page
  const readStep = live.def.steps.find((s) => s.kind === "read");
  const readPages = async (step: string, pages: Source[]) => {
    let done = 0;
    const subText = (live.state.plan?.sub || []).map((s) => `${s.id}. ${s.q}`).join("\n");
    await mapLimit(pages, 3, async (src) => {
      if (stopped()) return;
      try {
        live.state.stats.fetched++;
        const j = await firecrawlScrape(st, src.url).catch(() => null);
        const md = String(j?.data?.markdown || "");
        const title = String(j?.data?.metadata?.title || src.title);
        if (md.replace(/\s+/g, "").length < 300) {
          src.failed = "nothing readable (short extract, paywall or blocked)";
        } else {
          src.title = clip(title || src.title, 160);
          src.chars = md.length;
          const raw = await ask(st, live, live.def.prompts.extract, `Sub-questions the pipeline is answering:\n${subText}\n\nChosen for sub-question: ${src.sq || "1"}\nPage: ${src.url}\n\nPage text:\n${md.slice(0, budget.pageChars)}`, 1400).catch(() => "");
          const e = firstJson(raw);
          const verdict = String(e?.verdict || "");
          if (verdict === "unusable" || (!Array.isArray(e?.claims) && !Array.isArray(e?.points))) {
            src.failed = clip(String(e?.why || "the extractor found nothing usable"), 120);
          } else {
            src.claims = (Array.isArray(e?.claims) ? e!.claims : []).map((c) => {
              const o = (c || {}) as Record<string, unknown>;
              return { text: clip(String(o.text || ""), 300), quote: clip(String(o.quote || ""), 400) };
            }).filter((c) => c.text && c.quote).slice(0, 8);
            src.points = (Array.isArray(e?.points) ? e!.points : []).map((p) => clip(String(p), 240)).filter(Boolean).slice(0, 6);
            src.answers = (Array.isArray(e?.answers) ? e!.answers : []).map((a) => String(a)).filter((a) => live.state.plan?.sub.some((s) => s.id === a)).slice(0, 6);
            if (!src.claims.length && !src.points.length) src.failed = "nothing worth quoting";
            else {
              src.read = true;
              live.state.stats.read++;
              live.state.stats.claims += src.claims.length;
            }
          }
        }
      } catch (err) {
        src.failed = clip(String(err instanceof Error ? err.message : err), 120);
      }
      done++;
      setStep(live, step, { note: `${done}/${pages.length} pages · ${live.state.stats.claims} claims so far` });
      send(live, { t: "sources", sources: live.state.sources });
      persist(live);
    });
  };
  if (readStep && !stopped() && chosen.length) {
    setStep(live, readStep.id, { status: "running", startedAt: Date.now(), items: chosen.length });
    await readPages(readStep.id, chosen);
    const unusable = chosen.filter((s) => s.failed).length;
    finishStep(live, readStep.id, { items: chosen.length, note: `${live.state.stats.read} pages read · ${live.state.stats.claims} claims${unusable ? ` · ${unusable} unusable` : ""}` });
    log(live, readStep.id, `${live.state.stats.read} pages distilled, ${unusable} dropped with a reason`);
    persist(live);
  } else if (readStep) setStep(live, readStep.id, { status: "skipped", note: "no pages to read" });

  // ---- second pass: only what the first round left unanswered
  const gapStep = live.def.steps.find((s) => s.kind === "gaps");
  if (gapStep && !stopped()) {
    const evidence = () => live.state.sources.filter((s) => s.read);
    const unanswered = (live.state.plan?.sub || []).filter((s) => !evidence().some((e) => (e.answers || []).includes(s.id)));
    if (!budget.followups || !unanswered.length) {
      setStep(live, gapStep.id, { status: "skipped", note: unanswered.length ? "second pass is off" : "every sub-question has evidence" });
    } else {
      setStep(live, gapStep.id, { status: "running", startedAt: Date.now() });
      const digest = live.state.plan!.sub.map((s) => {
        const ev = evidence().filter((e) => (e.answers || []).includes(s.id));
        return `${s.id}. ${s.q}\n${ev.length ? ev.flatMap((e) => (e.claims || []).map((c) => `   - [${e.id}] ${c.text}`)).join("\n") : "   (no evidence yet)"}`;
      }).join("\n");
      const raw = await ask(st, live, live.def.prompts.gaps, `Question: ${q}\n\nSub-questions and the evidence collected so far:\n${digest}\n\nAt most ${budget.followups} follow-up queries.`, 800).catch(() => "");
      const j = firstJson(raw);
      const fups = (Array.isArray(j?.followups) ? j.followups : []).map((f) => {
        const o = (f || {}) as Record<string, unknown>;
        return { q: clip(String(o.q || ""), 200), query: clip(String(o.query || ""), 120), sq: String(o.sq || "") };
      }).filter((f) => f.query).slice(0, budget.followups);
      live.state.followups = fups;
      if (!fups.length) {
        finishStep(live, gapStep.id, { note: "nothing missing" });
        log(live, gapStep.id, unanswered.length ? "The gap pass found no search that would close what is missing" : "Evidence covers every sub-question");
      } else {
        log(live, gapStep.id, `${fups.length} follow-up ${fups.length === 1 ? "query" : "queries"}`);
        const before = live.state.sources.length;
        for (const f of fups) await addHits(gapStep.id, f.sq || unanswered[0]?.id || "1", f.query);
        send(live, { t: "sources", sources: live.state.sources });
        const fresh = live.state.sources.slice(before).slice(0, Math.min(4, budget.reads));
        for (const s of fresh) s.read = false;
        if (fresh.length) await readPages(gapStep.id, fresh);
        finishStep(live, gapStep.id, { items: fresh.length, note: `${fups.length} follow-up ${fups.length === 1 ? "query" : "queries"} · ${fresh.filter((s) => s.read).length} more pages read` });
      }
      persist(live);
    }
    send(live, { t: "sources", sources: live.state.sources });
  }

  // ---- write: the only step whose output leaves the window
  const evidenceText = () => {
    const usable = live.state.sources.filter((s) => s.read);
    const parts = usable.map((s) => {
      const head = `[${s.id}] ${s.title} — ${s.host}\nsq ${(s.answers || []).join(", ") || s.sq || "?"}`;
      const claims = (s.claims || []).map((c) => `- ${c.text}\n  quote: “${c.quote}”`).join("\n");
      const points = (s.points || []).map((p) => `- (context) ${p}`).join("\n");
      return [head, claims, points].filter(Boolean).join("\n");
    }).join("\n\n");
    const unusable = live.state.sources.filter((s) => s.failed).map((s) => `[${s.id}] ${s.url} — ${s.failed}`);
    return parts + (unusable.length ? `\n\nOpened but unusable:\n${unusable.join("\n")}` : "");
  };
  const writeStep = live.def.steps.find((s) => s.kind === "write");
  let report = "";
  if (writeStep && !stopped()) {
    setStep(live, writeStep.id, { status: "running", startedAt: Date.now() });
    const subText = (live.state.plan?.sub || []).map((s) => `${s.id}. ${s.q}`).join("\n");
    const raw = await ask(st, live, live.def.prompts.write, `Question: ${q}\n\nSub-questions:\n${subText}\n\nEvidence:\n${evidenceText()}\n\nWrite the report now. Cite every claim.`, budget.writeTokens).catch((e) => {
      log(live, writeStep.id, `Write failed: ${e instanceof Error ? e.message : String(e)}`);
      return "";
    });
    report = raw.trim();
    if (!report) {
      report = `_The report could not be written: the model returned nothing for this run._`;
      setStep(live, writeStep.id, { status: "failed", note: "empty reply" });
    } else {
      finishStep(live, writeStep.id, { items: report.split(/\s+/).length, note: `${report.split(/\s+/).length} words from ${live.state.sources.filter((s) => s.read).length} sources` });
    }
    live.state.report = report;
    send(live, { t: "report", report });
    persist(live);
  }

  // ---- check: verify against the evidence, then one bounded revision
  const checkStep = live.def.steps.find((s) => s.kind === "check");
  if (checkStep && !stopped() && report && !report.startsWith("_The report could not")) {
    setStep(live, checkStep.id, { status: "running", startedAt: Date.now() });
    const raw = await ask(st, live, live.def.prompts.check, `Question: ${q}\n\nDraft report:\n${report}\n\nEvidence:\n${evidenceText()}`, 900).catch(() => "");
    const j = firstJson(raw);
    const issues = (Array.isArray(j?.issues) ? j.issues : []).map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      return { kind: clip(String(o.kind || "issue"), 20), detail: clip(String(o.detail || ""), 300) };
    }).filter((x) => x.detail).slice(0, 12);
    live.state.check = { ok: !issues.length, issues };
    send(live, { t: "check", check: live.state.check });
    if (issues.length) {
      log(live, checkStep.id, `${issues.length} ${issues.length === 1 ? "problem" : "problems"} found — revising once`);
      const fixed = await ask(st, live, live.def.prompts.revise, `Question: ${q}\n\nProblems:\n${issues.map((x) => `- ${x.kind}: ${x.detail}`).join("\n")}\n\nEvidence:\n${evidenceText()}\n\nDraft report:\n${report}`, budget.writeTokens).catch(() => "");
      if (fixed.trim().length > 200) {
        report = fixed.trim();
        live.state.check = { ...live.state.check, revised: true };
        live.state.report = report;
        send(live, { t: "report", report });
        send(live, { t: "check", check: live.state.check });
      }
      finishStep(live, checkStep.id, { items: issues.length, note: `${issues.length} ${issues.length === 1 ? "issue" : "issues"} · revised once` });
    } else {
      finishStep(live, checkStep.id, { note: "every claim traced to a source" });
    }
    persist(live);
  } else if (checkStep) setStep(live, checkStep.id, { status: "skipped", note: "nothing to check" });

  // ---- deliver: the report enters the chat, everything else stays here
  const deliverStep = live.def.steps.find((s) => s.kind === "deliver");
  live.state.report = report;
  if (report) {
    const dir = runDir(live.state.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "report.md"), report);
    live.state.reportPath = `workflows/runs/${live.state.id}/report.md`;
  }
  if (stopped()) { if (deliverStep) setStep(live, deliverStep.id, { status: "skipped", note: "stopped before delivery" }); return stop("stopped"); }
  if (deliverStep) setStep(live, deliverStep.id, { status: "running", startedAt: Date.now() });
  const messageId = await deliver(live, report);
  if (messageId) {
    finishStep(live, deliverStep?.id || "deliver", { note: "report posted to the chat" });
    log(live, "deliver", "Report delivered — the window keeps the searches, pages and checks");
  } else {
    setStep(live, deliverStep?.id || "deliver", { status: "failed", note: "the chat this run belongs to is gone" });
  }
  stop("done");
}

/** Append the report to the conversation as an assistant message: the run's only footprint in chat. */
async function deliver(live: Live, report: string): Promise<string | null> {
  const convId = live.state.conversationId;
  if (!convId) return null;
  const rows = await db.select().from(messages).where(eq(messages.conversationId, convId)).catch(() => []);
  const conv = (await db.select().from(conversations).where(eq(conversations.id, convId)).catch(() => []))[0];
  if (!conv) return null;
  // chain onto the newest main-line message: the user may have kept chatting while this ran
  const parents = new Set(rows.map((m) => m.parentId).filter(Boolean) as string[]);
  const leaves = rows.filter((m) => !m.threadOf && !parents.has(m.id)).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const parentId = leaves.length ? leaves[leaves.length - 1].id : null;
  const id = nanoid(12);
  const part = { type: "run" as const, id: live.state.id, workflow: live.def.id, title: live.def.name, question: live.state.question };
  await db.insert(messages).values({
    id, conversationId: convId, parentId, threadOf: null, role: "assistant", content: report,
    parts: [part, { type: "text", text: report }],
  });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));
  live.state.messageId = id;
  return id;
}

// ------------------------------------------------------------------- lifecycle

export type StartOpts = { workflow: string; question: string; conversationId?: string };

export async function startWorkflowRun(o: StartOpts): Promise<{ runId: string; conversationId: string; title: string } | { error: string }> {
  const question = (o.question || "").trim().slice(0, 2000);
  if (!question) return { error: "An empty question is not a research run" };
  const def = await loadWorkflow(o.workflow);
  if (!def) return { error: `Unknown workflow: ${o.workflow}` };
  let conversationId = o.conversationId;
  let conv = conversationId ? (await db.select().from(conversations).where(eq(conversations.id, conversationId)))[0] : undefined;
  if (!conv) {
    conversationId = nanoid(10);
    const title = question.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60) || def.name;
    [conv] = await db.insert(conversations).values({ id: conversationId, title, state: {} }).returning();
  }
  const id = nanoid(12);
  const live: Live = {
    def,
    listeners: new Set(),
    ctrl: new AbortController(),
    done: false,
    writing: null,
    state: {
      id, workflow: def.id, workflowName: def.name, question, conversationId: conv.id, status: "running", createdAt: Date.now(),
      steps: def.steps.map((s) => ({ id: s.id, title: s.title, status: "pending" })),
      panes: def.panes,
      sources: [], followups: [], log: [], stats: { queries: 0, fetched: 0, read: 0, claims: 0, calls: 0 },
    },
  };
  runs.set(id, live);
  log(live, "run", `${def.name} started: ${clip(question, 160)}`);
  persist(live);
  void (async () => {
    const st = await getSettings();
    try {
      await pipeline(live, st);
    } catch (e) {
      live.state.error = e instanceof Error ? e.message : String(e);
      live.state.status = "failed";
      log(live, "run", `Failed: ${live.state.error}`);
    } finally {
      live.state.endedAt = Date.now();
      live.done = true;
      if (live.state.status === "running") live.state.status = "failed";
      await writeRun(live).catch(() => {});
      send(live, { t: "done", status: live.state.status, messageId: live.state.messageId, error: live.state.error });
      live.listeners.clear();
      void pruneRuns();
      // keep the finished run for a moment so a viewer that re-attaches right now gets the tail
      setTimeout(() => { if (runs.get(id) === live) runs.delete(id); }, 60_000);
    }
  })();
  return { runId: id, conversationId: conv.id, title: def.name };
}

/** Oldest runs are removed first; the newest MAX_KEPT stay openable from their chats. */
async function pruneRuns() {
  try {
    const dir = path.join(WS, "workflows", "runs");
    const names = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    if (names.length <= MAX_KEPT) return;
    const stamped = await Promise.all(names.map(async (n) => {
      const st = await fs.stat(path.join(dir, n)).catch(() => null);
      return { n, at: st?.mtimeMs || 0 };
    }));
    for (const x of stamped.sort((a, b) => a.at - b.at).slice(0, stamped.length - MAX_KEPT)) {
      if (runs.has(x.n)) continue;
      await fs.rm(path.join(dir, x.n), { recursive: true, force: true }).catch(() => {});
    }
  } catch { /* nothing to prune */ }
}

export const isRunning = (id: string) => !!runs.get(id) && !runs.get(id)!.done;
export const stopRun = (id: string) => { const r = runs.get(id); if (!r || r.done) return false; r.ctrl.abort(); log(r, "run", "Stopped by the user"); return true; };

/** Running runs, for the chat's cheap poll: enough to show progress and notice delivery. */
export function activeRuns() {
  return [...runs.values()].filter((r) => !r.done).map((r) => {
    const done = r.state.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    const current = r.state.steps.find((s) => s.status === "running");
    return {
      id: r.state.id, workflow: r.state.workflow, name: r.state.workflowName, question: r.state.question,
      conversationId: r.state.conversationId, startedAt: r.state.createdAt,
      progress: `${Math.min(done + 1, r.state.steps.length)}/${r.state.steps.length}`, step: current?.title || "Working",
      note: current?.note, messageId: r.state.messageId,
    };
  });
}

/** Runs that just finished: the chat page polls this to notice a delivered report. */
export function recentRuns(withinMs = 150_000) {
  return [...runs.values()]
    .filter((r) => r.done && r.state.endedAt && Date.now() - r.state.endedAt < withinMs)
    .map((r) => ({ id: r.state.id, conversationId: r.state.conversationId, messageId: r.state.messageId, status: r.state.status, name: r.state.workflowName }));
}

export async function runState(id: string): Promise<RunState | null> {
  const live = runs.get(id);
  if (live) return live.state;
  try { return JSON.parse(await fs.readFile(path.join(runDir(id), "run.json"), "utf8")) as RunState; } catch { return null; }
}

/** NDJSON stream of a run: the whole state first, then live events. Detaching never stops the run. */
export function attachRun(id: string, detach: AbortSignal): ReadableStream<Uint8Array> | null {
  const live = runs.get(id);
  if (!live) return null;
  const enc = new TextEncoder();
  let off = () => {};
  return new ReadableStream({
    start(ctrl) {
      const sendIt = (e: RunEvent) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* detached */ } };
      const close = () => { off(); try { ctrl.close(); } catch { /* already closed */ } };
      sendIt({ t: "state", state: live.state });
      if (live.done) { sendIt({ t: "done", status: live.state.status, messageId: live.state.messageId, error: live.state.error }); close(); return; }
      const l = (e: RunEvent) => { sendIt(e); if (e.t === "done") close(); };
      live.listeners.add(l);
      off = () => live.listeners.delete(l);
      detach.addEventListener("abort", close, { once: true });
    },
    cancel() { off(); },
  });
}
