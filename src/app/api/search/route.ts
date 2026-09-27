import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { conversations, messages, Part } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAgent } from "@/lib/agent";
import { endpoint, headers } from "@/lib/llm";
import { firecrawlSearch, firecrawlScrape } from "@/lib/web";
import { getSettings } from "@/lib/settings";
import { ReasoningSplitter, unverifiedUrls } from "@/lib/harness/stream";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { q: string; conversationId?: string };

/**
 * Search mode: the app opens here instead of a chat. One question in, one answer out, no tools,
 * no workspace state — unless the question actually needs the machine, in which case it is promoted
 * to a real chat on the spot.
 *
 * Routing is a first-token tag the model emits as its very first token, so there is no extra round
 * trip: [ANSWER] it knows it, [SEARCH] it needs the live web, [ACT] it needs to run something.
 * Heuristics only take over if the model never emits a tag.
 */
const TAG = /^\[(ANSWER|SEARCH|ACT)\]/i;

function guess(q: string): "ANSWER" | "SEARCH" | "ACT" {
  const s = q.toLowerCase();
  if (/https?:\/\/\S/.test(s) && /\b(scrape|fetch|open|read|summar|extract|download|save)\b/.test(s)) return "ACT";
  if (/\b(run|execute|install|uninstall|create|write|build|make|deploy|commit|push|edit|delete|remove|fix|convert|generate|download|clone|open|start|stop|restart|debug|scrape|extract)\b/.test(s)
    && /(\.[a-z0-9]{1,5}\b|\/|file|folder|repo|project|script|command|terminal|for me|please)/.test(s)) return "ACT";
  if (/\b(latest|news|today|tonight|this week|current|currently|price|cost|stock|weather|score|release|changelog|version|who is|who won|when did|where is|best|top \d|compare|vs\.?|review|tutorial|docs|documentation|near me|open now)\b/.test(s)) return "SEARCH";
  if (/\?$/.test(s) && /\b(who|what|when|where|which|how many|how much|is it|are there)\b/.test(s)) return "SEARCH";
  return "ANSWER";
}

const ROUTER_SYS = `You are the router of a personal assistant. Your reply must start with exactly one tag and nothing else before it:
[ANSWER] — general knowledge you already know with confidence and can answer fully.
[SEARCH] — anything that needs the live web: recent events, prices, versions, dates, people, places, documentation, comparisons, or anything you are not certain about.
[ACT] — anything that must run on this machine or touch files: run, install, create, write, edit, open, build, convert, scrape, debug.
Output only the tag. Choose [SEARCH] over [ANSWER] whenever you are not certain.`;

const ANSWER_SYS = `Answer directly and correctly. Be concise: the answer first, then only the detail that is asked for. No preamble, no filler, no "I hope this helps". Markdown is fine. If you are not sure, say so plainly instead of guessing.`;

const UNGROUNDED_SYS = `You could not reach the web. Answer from what you know, and open with one plain sentence saying the answer is from memory and may be out of date. If you are not confident, say that instead of guessing. Then answer concisely.`;

const SEARCH_SYS = `You answer using ONLY the search results below. Rules:
- Lead with the direct answer in one or two sentences.
- Then a numbered list of sources: [n](url) — one to three sentences each saying what that page actually says.
- Every claim must be traceable to a result. If the results do not answer it, say what you could not verify — never fill the gap from memory.
- Never invent a URL, and never cite a result that is not in the list below.
- End there. No preamble, no "let me know".`;

/** Drop a URL from markdown links / bare links when the page could not be opened. */
function stripUrls(text: string, bad: Set<string>) {
  return text
    .replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) => (bad.has(url) ? label : `[${label}](${url})`))
    .replace(/https?:\/\/\S+/g, (u) => (bad.has(u.replace(/[.,)]+$/, "")) ? "" : u))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const q = String(b.q || "").trim();
  if (!q) return Response.json({ error: "empty query" }, { status: 400 });

  const st = await getSettings();
  // a follow-up continues the same temporary conversation; a new question starts a fresh one
  const prev = b.conversationId ? (await db.select().from(conversations).where(eq(conversations.id, b.conversationId)))[0] : undefined;
  const convId = prev?.id || nanoid(10);
  const title = prev?.title || q.replace(/\s+/g, " ").trim().slice(0, 60);
  let parentId: string | null = null;
  if (prev) {
    const last = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, prev.id));
    parentId = last.map((m) => m.id).filter((x) => x !== null).slice(-1)[0] ?? null;
    await db.update(conversations).set({ kind: "search", updatedAt: new Date() }).where(eq(conversations.id, prev.id));
  } else {
    await db.insert(conversations).values({ id: convId, title, kind: "search" }).returning();
  }
  const now = new Date();
  const conv = { id: convId, title, kind: "search" as const, context: [] as string[], summary: null, summaryUpTo: null, state: {}, createdAt: now, updatedAt: now };
  const userId = nanoid(12);
  await db.insert(messages).values({ id: userId, conversationId: convId, parentId, role: "user", content: q });
  const assistantId = nanoid(12);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      emit({ t: "meta", conversationId: convId, userId, assistantId, parentId: userId, title, kind: "search" });
      try {
        // 1. route. The first token decides; the heuristic only covers a model that never tags.
        let route: "ANSWER" | "SEARCH" | "ACT" = guess(q);
        let buffered = "", decided = false;
        const onTag = (d: string) => {
          if (decided) return;
          buffered += d;
          const m = TAG.exec(buffered.trimStart());
          if (m) { route = m[1].toUpperCase() as typeof route; decided = true; }
          else if (buffered.length > 160) { route = guess(q); decided = true; }
        };
        await streamOnce(st, ROUTER_SYS, q, onTag, req.signal, 24);

        if (route === "ACT") {
          // it needs the machine: promote to a real chat and hand over to the full agent
          await db.update(conversations).set({ kind: "chat" }).where(eq(conversations.id, convId));
          emit({ t: "kind", kind: "chat" });
          await runAgent({ conv: { ...conv, kind: "chat" }, assistantId, parentId: userId, threadOf: null, emit, signal: req.signal });
          emit({ t: "done" });
          try { ctrl.close(); } catch {}
          return;
        }

        const split = new ReasoningSplitter();
        let text = "";
        let sources: string[] = [];
        /** One streamed completion, guarded by the reasoning splitter; returns the visible text. */
        const answerFrom = async (sys: string, user: string) => {
          const seen: string[] = [];
          const onDelta = (d: string) => { const s = split.push(d); if (s.text) { seen.push(s.text); emit({ t: "text", d: s.text }); } };
          const raw = await streamOnce(st, sys, user, onDelta, req.signal);
          const viaSplitter = seen.join("");
          return viaSplitter.trim() ? viaSplitter : raw.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "").trim();
        };

        if (route === "SEARCH") {
          emit({ t: "notice", text: "Searching the web…" });
          let results: { url: string; title?: string; description?: string; markdown?: string }[] = [];
          try {
            const j = await firecrawlSearch(st, q, 5);
            results = ((j.data || []) as typeof results).filter((r) => r?.url).slice(0, 5);
          } catch (e) {
            emit({ t: "notice", text: `Search failed: ${String(e).slice(0, 160)}` });
          }
          if (results.length) {
            sources = results.map((r) => r.url);
            const block = results.map((r, i) =>
              `[${i + 1}] ${r.title || r.url}\n${r.url}\n${(r.description || r.markdown || "").replace(/\s+/g, " ").slice(0, 700)}`).join("\n\n");
            text = await answerFrom(SEARCH_SYS, `Question: ${q}\n\nSearch results:\n${block}`);
          } else {
            emit({ t: "notice", text: "No results — answering from what I know, flagged as unverified." });
          }
        }

        // search found nothing usable: answer from memory, but say so first
        if (!text.trim()) text = await answerFrom(route === "SEARCH" ? UNGROUNDED_SYS : ANSWER_SYS, q);

        // 2. fact-check: a link must point at a page we actually opened
        const unverified = unverifiedUrls(text, sources.join("\n"));
        if (unverified.length) {
          const bad = new Set<string>();
          await Promise.all(unverified.slice(0, 3).map(async (u) => {
            try { const j = await firecrawlScrape(st, u); if (!(j?.data?.markdown || j?.data?.content || "").trim()) bad.add(u); }
            catch { bad.add(u); }
          }));
          for (const u of unverified.slice(3)) bad.add(u);
          if (bad.size) { const before = text; text = stripUrls(text, bad); if (before !== text) emit({ t: "notice", text: "Removed a link I could not open." }); }
        }

        const body = text.trim() || "(no answer)";
        const parts: Part[] = [{ type: "text", text: body, ...(unverified.length ? { unverified } : {}) }];
        await db.insert(messages).values({ id: assistantId, conversationId: convId, parentId: userId, role: "assistant", content: body, parts });
        if (sources.length) emit({ t: "sources", sources, unverified });
      } catch (e) {
        emit({ t: "error", text: String(e) });
      }
      emit({ t: "done" });
      try { ctrl.close(); } catch {}
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}

/** Minimal SSE reader; `maxTokens` keeps the router call from wandering. */
async function streamOnce(st: Awaited<ReturnType<typeof getSettings>>, sys: string, user: string, onDelta: (d: string) => void, signal?: AbortSignal, maxTokens?: number) {
  const r = await fetch(endpoint(st), {
    method: "POST", headers: headers(st), signal,
    body: JSON.stringify({
      model: st.model, stream: true, temperature: 0.4, ...(maxTokens ? { max_tokens: maxTokens } : {}),
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta?.content;
        if (typeof d === "string" && d) { out += d; onDelta(d); }
      } catch {}
    }
  }
  return out;
}
