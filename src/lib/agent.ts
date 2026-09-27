import fs from "fs/promises";
import path from "path";
import { db } from "@/db";
import { conversations, messages, Part } from "@/db/schema";
import { eq } from "drizzle-orm";
import { WS, treeText, resolvePath, readText, isImage, mimeOf, ensureWorkspace } from "./workspace";
import { getSettings, Settings } from "./settings";
import { toolDefs, execTool, ToolDef, ToolCtx, ConvState, Pack, todoReminder } from "./tools";
import { mcpTools, readServers } from "./mcp";
import { skillsIndex, findSkill, skillMeta, skillAllowed } from "./skills";
import { varsFor, varsIn } from "./credentials";
import { lintFiles, lintChat } from "./harness/check";
import { ReasoningSplitter, OpenerGate, trimCloser, findLoop, extractTextCalls, foreignSpans, fixPunct, replaceSpans, unverifiedUrls, urlsIn } from "./harness/stream";
import { StuckDetector } from "./harness/stuck";
import { integrityIssues, isCodeFile } from "./harness/integrity";
import { fmtIssues } from "./harness/slop";
import { mode as execMode } from "./exec";
import { est, estMsg, endpoint, headers, normalize, complete, OAMsg } from "./llm";
import { chain, assistantText, compactTools, compactWeb, compactHistory, turnReport, Msg, Conv, CtxReport, CtxSection } from "./context";
import { canvasPath } from "./shared";

export type Emit = (e: Record<string, unknown>) => void;

function envText(st: Settings) {
  const sb = execMode(st, false), host = execMode(st, true);
  const files = { sandbox: "workspace only", home: "workspace + user home (~/path or absolute paths under ~)", full: "entire disk (absolute paths)" }[st.access];
  const term = st.terminal === "host"
    ? `shell = your sandbox${sb.isolated ? " (isolated)" : ""}, cwd=workspace. host_shell = the user's own machine as the user, cwd=${host.cwd === WS ? "workspace" : "~"} (their installed toolchains and logins, e.g. gh, git, docker, SDKs).`
    : `shell = your sandbox${sb.isolated ? " (isolated)" : ""}, cwd=workspace. The user's own terminal is off.`;
  return `# Access\nFiles: ${files}. Terminal: ${term} sudo: ${st.terminal === "host" && st.sudo ? "allowed in host_shell (only when required, say why)" : "disabled"}. OS: ${process.platform}.`;
}
/** Tool packs active for a conversation (auto: large windows get everything up front, small ones load on demand). */
export function packsFor(st: Settings, state: ConvState | null | undefined): Pack[] {
  if (st.toolLoading === "all" || (st.toolLoading === "auto" && st.contextTokens >= 48000)) return ["dev"];
  return state?.packs || [];
}

type Sys = { text: string; sections: CtxSection[] };
async function buildSystem(conv: Conv, st: Settings, mcpNames: string[], budget: number): Promise<Sys> {
  const base = (await fs.readFile(path.join(WS, "system/SYSTEM.md"), "utf8").catch(() => "You are a helpful assistant.")).trim();
  const memory = (await fs.readFile(path.join(WS, "system/AGENTS.md"), "utf8").catch(() => "")).trim();
  const skills = `# Skills (skill_open to load)\n${await skillsIndex(st)}`;
  const tree = `# Workspace tree\n${await treeText()}`;
  const items: { path: string; tokens: number }[] = [];
  let files = "";
  let left = Math.floor(budget * 0.35 * 3.6);
  for (const p of conv.context) {
    let chunk: string;
    try {
      const abs = resolvePath(p, st.access);
      if (isImage(abs)) chunk = `<file path="${p}">(image, attached)</file>\n`;
      else { const t = await readText(abs, Math.max(2000, left)); left -= t.length; chunk = `<file path="${p}">\n${t}\n</file>\n`; }
    } catch { chunk = `<file path="${p}">(missing)</file>\n`; }
    files += chunk; items.push({ path: p, tokens: est(chunk) });
  }
  const parts: [string, string, string][] = [
    ["system", "System prompt", base],
    ["memory", "Memory (AGENTS.md)", memory && `# ${memory}`],
    ["skills", "Skills index", skills],
    ["env", "Environment", [mcpNames.length ? `# MCP servers\n${mcpNames.join(", ")}` : "", envText(st), `Date: ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join("\n\n")],
    ["tree", "Workspace tree", tree],
    ["files", "Files in context", files && `# Active context files\n${files}`],
  ];
  return {
    text: parts.map((p) => p[2]).filter(Boolean).join("\n\n"),
    sections: parts.filter((p) => p[2]).map(([key, label, t]) => ({ key, label, tokens: est(t), ...(key === "files" ? { items } : {}) })),
  };
}

async function userContent(m: Msg, last: boolean, access: Settings["access"]) {
  let text = m.content;
  if (m.quote) text = `> ${m.quote.replace(/\n/g, "\n> ")}\n\n${text}`;
  if (m.attachments.length) text += `\n[attached: ${m.attachments.map((a) => a.path).join(", ")}]`;
  if (!last) return text;
  const imgs = [];
  for (const a of m.attachments.filter((a) => isImage(a.path)).slice(0, 4)) {
    try { imgs.push({ type: "image_url", image_url: { url: `data:${mimeOf(a.path)};base64,${(await fs.readFile(resolvePath(a.path, access))).toString("base64")}` } }); } catch {}
  }
  return imgs.length ? [{ type: "text", text }, ...imgs] : text;
}

type Hist = { msgs: OAMsg[]; tokens: number; summaryTokens: number; toolTokens: number; path: Msg[]; trimmed: number };
export async function buildHistory(conv: Conv, all: Msg[], leafId: string, threadOf: string | null, st: Settings, budget: number): Promise<Hist> {
  const path_ = chain(all, leafId);
  let msgs = path_;
  const pre: OAMsg[] = [];
  if (threadOf) {
    const anchor = all.find((m) => m.id === threadOf);
    if (anchor) pre.push({ role: "user", content: `[Side thread about this earlier reply. Stay focused on it.]\n${assistantText(anchor).slice(0, 5000)}` }, { role: "assistant", content: "Understood." });
  } else {
    const i = conv.summaryUpTo ? msgs.findIndex((m) => m.id === conv.summaryUpTo) : -1;
    if (i >= 0 && conv.summary) { msgs = msgs.slice(i + 1); pre.push({ role: "user", content: `[Summary of earlier conversation]\n${conv.summary}` }, { role: "assistant", content: "Noted." }); }
  }
  let out: OAMsg[] = [];
  let toolTok = 0;
  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
    const last = k === msgs.length - 1;
    if (m.compact === "" && !last) continue;
    if (m.compact && !last) { out.push({ role: "user", content: "[Earlier turns, compacted]" }, { role: "assistant", content: m.compact }); continue; }
    if (m.role === "user") out.push({ role: "user", content: await userContent(m, last, st.access) });
    else {
      const t = assistantText(m);
      toolTok += est(t) - est(m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n"));
      out.push({ role: "assistant", content: t || "(no text)" });
    }
  }
  const size = (x: OAMsg[]) => x.reduce((a, m) => a + estMsg(m), 0);
  let trimmed = 0;
  while (out.length > 2 && size(out) + size(pre) > budget) { out.splice(0, 2); trimmed += 2; }
  out = normalize([...pre, ...out]);
  return { msgs: out, tokens: size(out), summaryTokens: size(pre), toolTokens: Math.max(0, toolTok), path: path_, trimmed };
}

async function mcpFor(st: Settings) {
  const servers = await readServers();
  return mcpTools(varsFor(st, varsIn(Object.values(servers).filter((c) => c.enabled))));
}
function allTools(st: Settings, packs: Pack[], mcp: Awaited<ReturnType<typeof mcpTools>>): ToolDef[] {
  return [
    ...toolDefs(st, packs),
    ...mcp.tools.map((t) => ({ type: "function" as const, function: { name: `mcp__${t.server}__${t.name}`.slice(0, 64), description: (t.description || "").slice(0, 300), parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} } } })),
  ];
}
const budgetOf = (st: Settings) => Math.max(6000, st.contextTokens - Math.min(8000, Math.max(2500, Math.round(st.contextTokens * 0.12))));

/** Full accounting of what the next request would send. Used by the Context status panel. */
export async function contextReport(convId: string, leafId: string | null, threadOf: string | null): Promise<CtxReport> {
  await ensureWorkspace();
  const st = await getSettings();
  const budget = budgetOf(st);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
  if (!conv) throw new Error("no conversation");
  const all = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
  const mcp = await mcpFor(st).catch(() => ({ tools: [], errors: [] }));
  const tools = allTools(st, packsFor(st, conv.state), mcp);
  const sys = await buildSystem(conv, st, [...new Set(mcp.tools.map((t) => t.server))], budget);
  const toolDefTok = est(JSON.stringify(tools));
  const leaf = leafId || [...all].filter((m) => (m.threadOf || null) === threadOf).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.id || null;
  const hist = leaf ? await buildHistory(conv, all, leaf, threadOf, st, Number.MAX_SAFE_INTEGER) : null;
  const sections: CtxSection[] = [
    ...sys.sections,
    { key: "tooldefs", label: `Tool definitions (${tools.length})`, tokens: toolDefTok },
    ...(hist?.summaryTokens ? [{ key: "summary", label: threadOf ? "Thread anchor" : "Summary", tokens: hist.summaryTokens }] : []),
    { key: "history", label: "Conversation", tokens: Math.max(0, (hist?.tokens || 0) - (hist?.summaryTokens || 0) - (hist?.toolTokens || 0)) },
    { key: "tools", label: "Tool output in history", tokens: hist?.toolTokens || 0 },
  ];
  return { budget, window: st.contextTokens, total: sections.reduce((a, s) => a + s.tokens, 0), sections, turns: hist ? turnReport(hist.path, conv) : [] };
}

/** Script intrusion (e.g. Chinese tokens in an English reply from a quantized distill): punctuation fixed locally, words via one short call. */
async function fixForeign(st: Settings, parts: Part[], userText: string) {
  const texts = parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text");
  const jobs = texts.flatMap((p) => foreignSpans(p.text, userText).map((s) => ({ p, s })));
  if (!jobs.length) return;
  const need = jobs.filter((j) => fixPunct(j.s.span) === null);
  let tr: unknown[] = [];
  if (need.length) {
    const out = await complete(st, [{ role: "user", content: `Fragments in another script slipped into a reply. For each, give the replacement word(s) in the reply's own language that fit the context. Reply with only a JSON array of strings, same order.\n\n${need.map((j, i) => `${i + 1}. "${j.s.span}" in: …${j.s.context.replace(/\n/g, " ")}…`).join("\n")}` }], 300);
    try { const m = out.match(/\[[\s\S]*\]/); tr = m ? JSON.parse(m[0]) : []; } catch {}
  }
  for (const p of texts) {
    const mine = jobs.filter((j) => j.p === p).map((j) => ({ ...j.s, r: fixPunct(j.s.span) ?? tr[need.indexOf(j)] })).filter((x): x is typeof x & { r: string } => typeof x.r === "string" && !!x.r.trim());
    if (mine.length) p.text = replaceSpans(p.text, mine, mine.map((x) => x.r));
  }
}

export async function runAgent(opts: { conv: Conv; assistantId: string; parentId: string; threadOf: string | null; emit: Emit; signal: AbortSignal }) {
  await ensureWorkspace();
  const { assistantId, parentId, threadOf, emit, signal } = opts;
  let conv = opts.conv;
  const st = await getSettings();
  const budget = budgetOf(st);
  let all = await db.select().from(messages).where(eq(messages.conversationId, conv.id));

  // @mentions and attachments pull files into context once; later mentions are no-ops
  const parent = all.find((m) => m.id === parentId);
  if (parent?.role === "user") {
    const mentioned = [...parent.content.matchAll(/@((?:~\/|\/)?[\w./~-]+\.[\w]+|[\w-]+\/[\w./-]+)/g)].map((x) => x[1]);
    const add: string[] = [];
    for (const p of [...mentioned, ...parent.attachments.filter((a) => !isImage(a.path)).map((a) => a.path)]) {
      try { await fs.access(resolvePath(p, st.access)); if (!conv.context.includes(p) && !add.includes(p)) add.push(p); } catch {}
    }
    if (add.length) {
      conv = { ...conv, context: [...conv.context, ...add] };
      await db.update(conversations).set({ context: conv.context }).where(eq(conversations.id, conv.id));
      emit({ t: "context", context: conv.context });
    }
  }

  const mcp = await mcpFor(st);
  if (mcp.errors.length) emit({ t: "notice", text: "MCP: " + mcp.errors.join("; ") });
  let state: ConvState = conv.state || {};
  let tools = allTools(st, packsFor(st, state), mcp);
  const mcpNames = [...new Set(mcp.tools.map((t) => t.server))];
  let toolDefTok = est(JSON.stringify(tools));

  const parts: Part[] = [];
  const lastText = () => { for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (p.type === "text") return p; if (p.type === "tool") return null; } return null; };
  let thinkStart = 0;
  const endThink = () => { const r = parts[parts.length - 1]; if (r?.type === "reasoning" && r.ms === undefined) r.ms = Date.now() - thinkStart; };
  const pushText = (d: string) => { endThink(); const l = parts[parts.length - 1]; if (l?.type === "text") l.text += d; else parts.push({ type: "text", text: d }); };
  const pushReasoning = (d: string) => { const l = parts[parts.length - 1]; if (l?.type === "reasoning") l.text += d; else { thinkStart = Date.now(); parts.push({ type: "reasoning", text: d }); } emit({ t: "reasoning", d }); };
  const reload = async () => { all = await db.select().from(messages).where(eq(messages.conversationId, conv.id)); [conv] = await db.select().from(conversations).where(eq(conversations.id, conv.id)); };
  const ctx: ToolCtx = {
    settings: st, conversationId: conv.id, pinned: conv.context, emit, state,
    setState: async (next: ConvState) => { state = next; ctx.state = next; conv = { ...conv, state: next }; await db.update(conversations).set({ state: next }).where(eq(conversations.id, conv.id)); },
    setPinned: async (p: string[]) => { ctx.pinned = p; conv = { ...conv, context: p }; await db.update(conversations).set({ context: p }).where(eq(conversations.id, conv.id)); emit({ t: "context", context: p }); },
    compact: async (scope = "history", keepLast = 4) => {
      const pathNow = chain(all, parentId);
      let r: string;
      if (scope === "tools") r = `compacted ${await compactTools(pathNow, { keepLast })} tool outputs`;
      else if (scope === "web") r = `compacted ${await compactWeb(pathNow, st, keepLast)} web results`;
      else r = await compactHistory(conv, pathNow, st, keepLast);
      await reload(); emit({ t: "compacted" });
      return r;
    },
  };

  let sys = await buildSystem(conv, st, mcpNames, budget);
  let hist = await buildHistory(conv, all, parentId, threadOf, st, Number.MAX_SAFE_INTEGER);
  // Auto-compaction: first fold old tool output (free), then the builder trims oldest turns.
  if (est(sys.text) + toolDefTok + hist.tokens > budget * 0.9) {
    const n = await compactTools(hist.path, { keepLast: 4 });
    if (n) { await reload(); emit({ t: "notice", text: `Context nearly full — folded ${n} old tool outputs.` }); emit({ t: "compacted" }); }
  }
  hist = await buildHistory(conv, all, parentId, threadOf, st, budget - est(sys.text) - toolDefTok);
  if (hist.trimmed) emit({ t: "notice", text: `Oldest ${hist.trimmed} messages are outside the context window. /compact keeps them as a summary.` });
  const loopMsgs: OAMsg[] = [];

  // Slash workflows: "/research topic" preloads that skill for this request (saves a round trip for small models).
  const slash = parent?.role === "user" ? parent.content.match(/^\/([\w-]+)\b/) : null;
  if (slash) {
    const sk = await findSkill(slash[1]);
    if (sk && skillAllowed(sk, st)) {
      const last = hist.msgs[hist.msgs.length - 1];
      const body = sk.text.replace(/^---[\s\S]*?---\n/, "");
      const add = `\n\n<skill name="${sk.name}">\n${body}\n</skill>`;
      if (last?.role === "user") last.content = typeof last.content === "string" ? last.content + add : [...(last.content as { type: string }[]), { type: "text", text: add }] as OAMsg["content"];
      if (/\bdev\b/.test(skillMeta(sk.text).tools) && !(state.packs || []).includes("dev")) await ctx.setState({ ...state, packs: [...(state.packs || []), "dev"] });
    }
  }

  const touched = new Set<string>();
  const snapshots = new Map<string, string>(); // file content before this turn's first write (integrity diff)
  const brief = [...hist.path.filter((m) => m.role === "user").slice(-3).map((m) => m.content)].join("\n");
  type TP = Extract<Part, { type: "tool" }>;
  const toolSeen = (ps: Part[]) => ps.filter((p): p is TP => p.type === "tool").map((p) => `${p.result || ""} ${JSON.stringify((p.meta as { sources?: unknown } | undefined)?.sources || "")}`);
  /** Everything the model actually saw: prompt + pinned files, user messages, tool results and sources (never its own earlier prose). */
  const seenText = () => [sys.text, ...hist.path.flatMap((m) => (m.role === "user" ? [m.content] : toolSeen(m.parts))), ...toolSeen(parts)].join("\n");
  const stuck = new StuckDetector();
  let opener = new OpenerGate();
  let sep = false; // next visible text continues a cut-off part: start a new paragraph
  let qualityRounds = 0, loopRetries = 0, citeRounds = 0, blocksRounds = 0, lastEdit = -1, lastVerify = -1, callNo = 0, usedWeb = false;
  const VERIFY = /^(shell|host_shell|run_python|check|proc_start|proc_logs|browser)$/;
  const maxSteps = () => (packsFor(st, state).includes("dev") ? 40 : 16);
  /** Replace the text this step produced (retract reasoning, cut a loop, remove a printed tool call). */
  const rewriteStep = (stepText: string, next: string) => {
    const lt = lastText();
    if (!lt || !lt.text.endsWith(stepText)) return;
    lt.text = lt.text.slice(0, lt.text.length - stepText.length) + next;
    if (!lt.text) parts.splice(parts.indexOf(lt), 1);
    emit({ t: "retext", text: lt.text });
  };
  try {
    for (let step = 0; step < maxSteps(); step++) {
      tools = allTools(st, packsFor(st, state), mcp);
      toolDefTok = est(JSON.stringify(tools));
      const res = await fetch(endpoint(st), {
        method: "POST", signal, headers: headers(st),
        body: JSON.stringify({ model: st.model, stream: true, messages: [{ role: "system", content: sys.text }, ...hist.msgs, ...loopMsgs], tools }),
      });
      if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const split = new ReasoningSplitter();
      let buf = "", text = "", thought = "", checkedAt = 0, thoughtAt = 0, looped = false;
      const stepStart = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calls: any[] = [];
      const visible = (t: string) => {
        let v = opener.push(t);
        if (v && sep) { const lt = lastText(); if (lt && lt.text && !/\s$/.test(lt.text)) v = "\n\n" + v.replace(/^\s+/, ""); sep = false; }
        if (v) { text += v; pushText(v); emit({ t: "text", d: v }); }
      };
      const onContent = (c: string) => {
        const r = split.push(c);
        if (r.orphan) { rewriteStep(text, ""); text = ""; opener = new OpenerGate(); }
        if (r.reasoning) { thought += r.reasoning; pushReasoning(r.reasoning); if (r.orphan) thinkStart = stepStart; }
        if (r.text) visible(r.text);
      };
      read: for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          const l = line.trim();
          if (!l.startsWith("data:")) continue;
          const data = l.slice(5).trim();
          if (data === "[DONE]") continue;
          let j; try { j = JSON.parse(data); } catch { continue; }
          const d = j.choices?.[0]?.delta;
          if (!d) continue;
          const rc = d.reasoning_content ?? d.reasoning;
          if (typeof rc === "string" && rc) { thought += rc; pushReasoning(rc); }
          if (d.content) onContent(d.content);
          for (const tc of d.tool_calls || []) {
            endThink();
            const i = tc.index ?? calls.length;
            const fresh = !calls[i];
            calls[i] ??= { id: tc.id || `call_${i}_${Date.now()}`, type: "function", function: { name: "", arguments: "" } };
            if (tc.id) calls[i].id = tc.id;
            if (tc.function?.name) calls[i].function.name += tc.function.name;
            if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
            if (tc.extra_content) calls[i].extra_content = tc.extra_content;
            if (fresh && calls[i].function.name) emit({ t: "toolStart", id: calls[i].id, name: calls[i].function.name });
          }
          // Degenerate repetition: cut the stream instead of burning the whole output budget.
          if (text.length - checkedAt > 240) { checkedAt = text.length; const k = findLoop(text); if (k >= 0) { rewriteStep(text, text.slice(0, k)); text = text.slice(0, k); looped = true; } }
          if (thought.length - thoughtAt > 600) { thoughtAt = thought.length; if (findLoop(thought) >= 0) looped = true; }
          if (looped) { await reader.cancel().catch(() => {}); break read; }
        }
      }
      if (!looped) { const e = split.end(); if (e.reasoning) pushReasoning(e.reasoning); if (e.text) visible(e.text); }
      { const held = opener.flush(); if (held) { text += held; pushText(held); emit({ t: "text", d: held }); } }
      endThink();
      if (looped) {
        emit({ t: "notice", text: "Stopped a repetition loop in the model output." });
        if (loopRetries++ < 1) {
          sep = true;
          loopMsgs.push({ role: "assistant", content: text || "(cut)" });
          loopMsgs.push({ role: "user", content: "[Automatic note, not from the user] Your output began repeating itself and was cut. Continue from where the useful content ended. Do not repeat earlier sentences." });
          continue;
        }
        break;
      }
      const valid = calls.filter(Boolean);
      // Small local models often print the tool call as text instead of calling it; promote it to a real call.
      if (!valid.length && text) {
        const x = extractTextCalls(text, new Set(tools.map((t) => t.function.name)));
        if (x.calls.length) {
          rewriteStep(text, x.cleaned); text = x.cleaned;
          x.calls.forEach((c, i) => valid.push({ id: `txt_${step}_${i}_${Date.now()}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
        }
      }
      if (!valid.length) {
        // Post-turn quality guard (one round): design/prose lint, code integrity and "changed but never ran it".
        if (st.quality !== "off" && touched.size && qualityRounds < 1 && !signal.aborted) {
          qualityRounds++;
          const files = [...touched];
          const lint = await lintFiles(files.map((p) => ({ path: p, abs: resolvePath(p, st.access) })), brief);
          const integ: string[] = [];
          for (const f of files) {
            if (!isCodeFile(f)) continue;
            const now = await fs.readFile(resolvePath(f, st.access), "utf8").catch(() => "");
            const iss = integrityIssues(f, snapshots.get(f) ?? "", now, brief);
            if (iss.length) integ.push(fmtIssues(iss, f));
          }
          const code = files.filter(isCodeFile);
          const unverified = code.length && lastVerify < lastEdit ? `- ${code.slice(0, 4).join(", ")}: code changed but nothing ran after the last edit. Run it or its tests before claiming it works; if it cannot run here, say it is untested.` : "";
          const report = [lint, ...integ, unverified].filter(Boolean).join("\n");
          if (report) {
            const id = `qc_${Date.now()}`;
            const part: Part = { type: "tool", id, name: "quality_check", args: { files }, result: report, ok: false };
            parts.push(part);
            emit({ t: "tool", id, name: part.name, args: part.args });
            emit({ t: "toolResult", id, result: report, ok: false });
            if (st.quality === "fix") {
              loopMsgs.push({ role: "assistant", content: text || "(done)" });
              loopMsgs.push({ role: "user", content: `[Automatic check, not from the user] Issues in files you changed:\n${report}\nFix what is real (fs_edit / run it). If a flag is wrong for this request, ignore it. Then reply with one short line saying what changed.` });
              continue;
            }
          }
        }
        // BlocksUI guard (one round): a broken component must never be the final answer.
        if (st.quality === "fix" && blocksRounds < 1 && text && !signal.aborted) {
          const report = lintChat(text, brief);
          if (report) {
            blocksRounds++;
            const id = `blk_${Date.now()}`;
            const part: Part = { type: "tool", id, name: "blocks_check", args: {}, result: report, ok: false };
            parts.push(part);
            emit({ t: "tool", id, name: part.name, args: part.args });
            emit({ t: "toolResult", id, result: report, ok: false });
            loopMsgs.push({ role: "assistant", content: text });
            loopMsgs.push({ role: "user", content: `[Automatic BlocksUI check, not from the user] These components are broken:\n${report}\nReturn the same answer again with every issue fixed and everything else unchanged. Do not call tools.` });
            continue;
          }
        }
        // Citation guard: links in a web-backed answer that never appeared in any result → verify or drop, once.
        if (st.quality === "fix" && usedWeb && citeRounds < 1 && text && !signal.aborted) {
          const bad = unverifiedUrls(text, seenText());
          if (bad.length) {
            citeRounds++;
            rewriteStep(text, "");
            loopMsgs.push({ role: "assistant", content: text });
            loopMsgs.push({ role: "user", content: `[Automatic citation check, not from the user] These links did not appear in any search result or page you opened: ${bad.slice(0, 8).join(" ")}. web_fetch the ones you need to confirm them, or remove them. Cite only pages you actually saw. Then give the complete answer again.` });
            continue;
          }
        }
        break;
      }
      loopMsgs.push({ role: "assistant", content: text || null, tool_calls: valid });
      const images: string[] = [];
      let stop = false, nudge = "";
      for (const c of valid) {
        let args: Record<string, unknown> = {};
        let bad = "";
        try { args = JSON.parse(c.function.arguments || "{}"); } catch (e) { bad = `Invalid JSON arguments (${(e as Error).message}). Resend the call with valid JSON.`; }
        const part: Part = { type: "tool", id: c.id, name: c.function.name, args };
        parts.push(part);
        ctx.toolId = c.id; // long tools stream raw output against this id
        emit({ t: "tool", id: c.id, name: part.name, args });
        const name = c.function.name;
        if (/^fs_(write|edit|insert)$/.test(name) && typeof args.path === "string" && !snapshots.has(args.path)) snapshots.set(args.path, await fs.readFile(resolvePath(args.path, st.access), "utf8").catch(() => ""));
        const out = bad ? { ok: false, result: bad } as Awaited<ReturnType<typeof execTool>> : await execTool(name, args, ctx);
        callNo++;
        if (out.ok && /^fs_(write|edit|insert)$/.test(name) && typeof args.path === "string") { touched.add(args.path); if (isCodeFile(args.path)) lastEdit = callNo; }
        if (VERIFY.test(name)) lastVerify = callNo;
        if (/^web_/.test(name) || /^mcp__.*(search|fetch|browse)/i.test(name)) usedWeb = true;
        if (out.images?.length) images.push(...out.images);
        if (out.stop) stop = true;
        Object.assign(part, { result: out.result, ok: out.ok, meta: out.meta });
        emit({ t: "toolResult", id: c.id, result: out.result.slice(0, 20000), ok: out.ok, meta: out.meta });
        loopMsgs.push({ role: "tool", tool_call_id: c.id, content: out.result });
        stuck.add({ name, args, result: out.result, ok: out.ok });
        const s = stuck.check();
        if (s?.stop) { stop = true; emit({ t: "notice", text: s.stop }); pushText(`\n\n> ${s.stop}`); }
        else if (s?.nudge) nudge = s.nudge;
      }
      if (stop) break;
      const lastTool = loopMsgs[loopMsgs.length - 1];
      if (nudge && lastTool.role === "tool" && typeof lastTool.content === "string") lastTool.content += `\n\n[Automatic note] ${nudge}`;
      // Recitation: keep the open plan at the end of context (only while a checklist exists).
      const rem = todoReminder(state.todo);
      if (rem && lastTool.role === "tool" && typeof lastTool.content === "string" && !valid.some((c) => c.function.name === "todo")) lastTool.content += rem;
      // Vision: tool results are text-only in the OpenAI format, so images follow as a user message.
      if (images.length && st.vision !== false) {
        const content: { type: string; text?: string; image_url?: { url: string } }[] = [{ type: "text", text: `[images from ${valid.map((c) => c.function.name).join(", ")}]` }];
        for (const img of images.slice(0, 3)) {
          try { const abs = resolvePath(img, st.access); content.push({ type: "image_url", image_url: { url: `data:${mimeOf(abs)};base64,${(await fs.readFile(abs)).toString("base64")}` } }); } catch {}
        }
        loopMsgs.push({ role: "user", content: content as OAMsg["content"] });
      }
      const names = valid.map((c) => c.function.name);
      if (names.some((n) => n === "context_add" || n === "context_remove")) sys = await buildSystem(conv, st, mcpNames, budget);
      if (names.includes("compact_context")) hist = await buildHistory(conv, all, parentId, threadOf, st, budget - est(sys.text) - toolDefTok);
      // keep in-turn tool loop bounded: fold oversized earlier tool results and drop old images of this turn
      const loopTok = loopMsgs.reduce((a, m) => a + estMsg(m), 0);
      if (loopTok > budget * 0.45) for (const m of loopMsgs.slice(0, -valid.length * 2 - 1)) {
        if (m.role === "tool" && typeof m.content === "string" && m.content.length > 600) m.content = m.content.slice(0, 500) + "\n… (folded to save context; re-run the tool if needed)";
        if (m.role === "user" && Array.isArray(m.content)) m.content = "[earlier screenshot/image removed to save context]";
      }
    }
  } catch (e) {
    if (!signal.aborted) { const msg = e instanceof Error ? e.message : String(e); pushText(`\n\n> ${msg}`); emit({ t: "error", text: msg }); }
  }

  // End-of-turn text hygiene. The client refetches the saved message right after the stream, so fixes show up there.
  if (!signal.aborted) {
    const lt = lastText();
    if (lt) lt.text = trimCloser(lt.text);
    await fixForeign(st, parts, brief).catch(() => {});
    const seen = seenText();
    for (const p of parts) if (p.type === "text" && urlsIn(p.text).length) { const u = unverifiedUrls(p.text, seen); if (u.length) p.unverified = u; else delete p.unverified; }
  }
  const content = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  // the live output buffer is a UI affordance; the saved part keeps only the final result
  const saved = parts.map((p) => { if (p.type !== "tool" || p.out === undefined) return p; const { out: _out, ...rest } = p; return rest; });
  await db.insert(messages).values({ id: assistantId, conversationId: conv.id, parentId, threadOf, role: "assistant", content, parts: saved });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conv.id));

  // persist canvases as artifacts (same title = update in place)
  for (const m of content.matchAll(/<canvas\s+title="([^"]*)"[^>]*>([\s\S]*?)<\/canvas>/g)) {
    const rel = canvasPath(m[1], m[2]);
    const body = rel.endsWith(".ui") ? m[2].replace(/^[\s\S]*?<ui[^>]*>/, "").replace(/<\/ui>[\s\S]*$/, "").trim() : m[2].trim();
    await fs.mkdir(path.join(WS, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(WS, rel), body);
    emit({ t: "artifact", path: rel });
  }
  // mirror chat into workspace
  const fresh = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
  await fs.mkdir(path.join(WS, "chats"), { recursive: true });
  await fs.writeFile(path.join(WS, "chats", `${conv.id}.json`), JSON.stringify({ conversation: conv, messages: fresh }, null, 1)).catch(() => {});
}
