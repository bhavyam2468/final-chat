import fs from "fs/promises";
import path from "path";
import { db } from "@/db";
import { conversations, messages, Part } from "@/db/schema";
import { eq } from "drizzle-orm";
import { WS, treeText, resolvePath, readText, isImage, mimeOf, ensureWorkspace } from "./workspace";
import { getSettings, Settings } from "./settings";
import { CORE_TOOLS, execTool, ToolDef, ToolCtx } from "./tools";
import { mcpTools } from "./mcp";
import { mode as execMode } from "./exec";
import { est, estMsg, endpoint, headers, normalize, OAMsg } from "./llm";
import { chain, assistantText, compactTools, compactWeb, compactHistory, turnReport, Msg, Conv, CtxReport, CtxSection } from "./context";
import { canvasPath } from "./shared";

export type Emit = (e: Record<string, unknown>) => void;

async function skillsIndex() {
  const dir = path.join(WS, "system/skills");
  const out: string[] = [];
  for (const d of (await fs.readdir(dir).catch(() => [] as string[])).sort()) {
    const txt = await fs.readFile(path.join(dir, d, "SKILL.md"), "utf8").catch(() => "");
    const desc = txt.match(/description:\s*(.+)/)?.[1] || "";
    if (txt) out.push(`- ${d}: ${desc}`);
  }
  return out.join("\n");
}

function envText(st: Settings) {
  const m = execMode(st);
  const files = { sandbox: "workspace only", home: "workspace + user home (~/path or absolute paths under ~)", full: "entire disk (absolute paths)" }[st.access];
  const term = m.sandboxed ? `sandboxed${m.isolated ? " (isolated)" : ""}, cwd=workspace` : `user's real host shell, cwd=${m.cwd === WS ? "workspace" : "~"}`;
  return `# Access\nFiles: ${files}. Terminal: ${term}. sudo: ${!m.sandboxed && st.sudo ? "allowed (use only when required, say why)" : "disabled"}.`;
}

type Sys = { text: string; sections: CtxSection[] };
async function buildSystem(conv: Conv, st: Settings, mcpNames: string[], budget: number): Promise<Sys> {
  const base = (await fs.readFile(path.join(WS, "system/SYSTEM.md"), "utf8").catch(() => "You are a helpful assistant.")).trim();
  const memory = (await fs.readFile(path.join(WS, "system/AGENTS.md"), "utf8").catch(() => "")).trim();
  const skills = `# Skills (skill_open to load)\n${await skillsIndex()}`;
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

function allTools(mcp: Awaited<ReturnType<typeof mcpTools>>): ToolDef[] {
  return [
    ...CORE_TOOLS,
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
  const mcp = await mcpTools({ ...st.secrets }).catch(() => ({ tools: [], errors: [] }));
  const tools = allTools(mcp);
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

  const mcp = await mcpTools({ ...st.secrets });
  if (mcp.errors.length) emit({ t: "notice", text: "MCP: " + mcp.errors.join("; ") });
  const tools = allTools(mcp);
  const mcpNames = [...new Set(mcp.tools.map((t) => t.server))];
  const toolDefTok = est(JSON.stringify(tools));

  const parts: Part[] = [];
  const pushText = (d: string) => { const l = parts[parts.length - 1]; if (l?.type === "text") l.text += d; else parts.push({ type: "text", text: d }); };
  const reload = async () => { all = await db.select().from(messages).where(eq(messages.conversationId, conv.id)); [conv] = await db.select().from(conversations).where(eq(conversations.id, conv.id)); };
  const ctx: ToolCtx = {
    settings: st, conversationId: conv.id, pinned: conv.context, emit,
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

  try {
    for (let step = 0; step < 12; step++) {
      const res = await fetch(endpoint(st), {
        method: "POST", signal, headers: headers(st),
        body: JSON.stringify({ model: st.model, stream: true, messages: [{ role: "system", content: sys.text }, ...hist.msgs, ...loopMsgs], tools }),
      });
      if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", text = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calls: any[] = [];
      for (;;) {
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
          if (d.content) { text += d.content; pushText(d.content); emit({ t: "text", d: d.content }); }
          for (const tc of d.tool_calls || []) {
            const i = tc.index ?? calls.length;
            const fresh = !calls[i];
            calls[i] ??= { id: tc.id || `call_${i}_${Date.now()}`, type: "function", function: { name: "", arguments: "" } };
            if (tc.id) calls[i].id = tc.id;
            if (tc.function?.name) calls[i].function.name += tc.function.name;
            if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
            if (tc.extra_content) calls[i].extra_content = tc.extra_content;
            if (fresh && calls[i].function.name) emit({ t: "toolStart", id: calls[i].id, name: calls[i].function.name });
          }
        }
      }
      const valid = calls.filter(Boolean);
      if (!valid.length) break;
      loopMsgs.push({ role: "assistant", content: text || null, tool_calls: valid });
      for (const c of valid) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
        const part: Part = { type: "tool", id: c.id, name: c.function.name, args };
        parts.push(part);
        emit({ t: "tool", id: c.id, name: part.name, args });
        const out = await execTool(c.function.name, args, ctx);
        Object.assign(part, { result: out.result, ok: out.ok, meta: out.meta });
        emit({ t: "toolResult", id: c.id, result: out.result.slice(0, 20000), ok: out.ok, meta: out.meta });
        loopMsgs.push({ role: "tool", tool_call_id: c.id, content: out.result });
      }
      const names = valid.map((c) => c.function.name);
      if (names.some((n) => n === "context_add" || n === "context_remove")) sys = await buildSystem(conv, st, mcpNames, budget);
      if (names.includes("compact_context")) hist = await buildHistory(conv, all, parentId, threadOf, st, budget - est(sys.text) - toolDefTok);
      // keep in-turn tool loop bounded: fold oversized earlier tool results of this turn
      const loopTok = loopMsgs.reduce((a, m) => a + estMsg(m), 0);
      if (loopTok > budget * 0.45) for (const m of loopMsgs.slice(0, -valid.length * 2)) if (m.role === "tool" && typeof m.content === "string" && m.content.length > 600) m.content = m.content.slice(0, 500) + "\n… (folded to save context; re-run the tool if needed)";
    }
  } catch (e) {
    if (!signal.aborted) { const msg = e instanceof Error ? e.message : String(e); pushText(`\n\n> ${msg}`); emit({ t: "error", text: msg }); }
  }

  const content = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  await db.insert(messages).values({ id: assistantId, conversationId: conv.id, parentId, threadOf, role: "assistant", content, parts });
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
