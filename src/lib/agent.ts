import fs from "fs/promises";
import path from "path";
import { db } from "@/db";
import { conversations, messages, Part } from "@/db/schema";
import { eq } from "drizzle-orm";
import { WS, treeText, resolvePath, readText, isImage, mimeOf, ensureWorkspace } from "./workspace";
import { getSettings, Settings } from "./settings";
import { CORE_TOOLS, execTool, ToolDef } from "./tools";
import { mcpTools } from "./mcp";

type Msg = typeof messages.$inferSelect;
type Conv = typeof conversations.$inferSelect;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAMsg = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string };
export type Emit = (e: Record<string, unknown>) => void;

const est = (s: string) => Math.ceil(s.length / 3.6);

async function skillsIndex() {
  const dir = path.join(WS, "system/skills");
  const out: string[] = [];
  for (const d of await fs.readdir(dir).catch(() => [] as string[])) {
    const txt = await fs.readFile(path.join(dir, d, "SKILL.md"), "utf8").catch(() => "");
    const desc = txt.match(/description:\s*(.+)/)?.[1] || "";
    if (txt) out.push(`- ${d}: ${desc}`);
  }
  return out.join("\n");
}

async function systemPrompt(conv: Conv, st: Settings, mcpNames: string[], budget: number) {
  const base = await fs.readFile(path.join(WS, "system/SYSTEM.md"), "utf8").catch(() => "You are a helpful assistant.");
  const memory = await fs.readFile(path.join(WS, "system/AGENTS.md"), "utf8").catch(() => "");
  let ctxFiles = "";
  let left = Math.floor(budget * 0.35 * 3.6);
  for (const p of conv.context) {
    try {
      const abs = resolvePath(p, st.access === "full");
      if (isImage(abs)) { ctxFiles += `<file path="${p}">(image, attached)</file>\n`; continue; }
      const t = await readText(abs, Math.max(2000, left));
      left -= t.length;
      ctxFiles += `<file path="${p}">\n${t}\n</file>\n`;
    } catch { ctxFiles += `<file path="${p}">(missing)</file>\n`; }
  }
  return [
    base.trim(),
    memory.trim() && `# ${memory.trim()}`,
    `# Skills (skill_open to load)\n${await skillsIndex()}`,
    mcpNames.length ? `# MCP servers\n${mcpNames.join(", ")}` : "",
    `# Access: ${st.access}${st.access === "full" ? " (absolute paths & real disk allowed)" : " (workspace only)"}`,
    `# Workspace tree\n${await treeText()}`,
    ctxFiles && `# Active context files\n${ctxFiles}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
  ].filter(Boolean).join("\n\n");
}

function chain(all: Msg[], leafId: string | null): Msg[] {
  const by = new Map(all.map((m) => [m.id, m]));
  const out: Msg[] = [];
  let cur = leafId ? by.get(leafId) : undefined;
  while (cur) { out.unshift(cur); cur = cur.parentId ? by.get(cur.parentId) : undefined; }
  return out;
}

function assistantText(m: Msg) {
  return m.parts.map((p) => p.type === "text" ? p.text : `[${p.name}(${JSON.stringify(p.args).slice(0, 120)}) -> ${(p.result || "").slice(0, 300).replace(/\s+/g, " ")}]`).join("\n");
}

async function userContent(m: Msg, last: boolean, full: boolean) {
  let text = m.content;
  if (m.quote) text = `> ${m.quote.replace(/\n/g, "\n> ")}\n\n${text}`;
  if (m.attachments.length) text += `\n[attached: ${m.attachments.map((a) => a.path).join(", ")}]`;
  if (!last) return text;
  const imgs = [];
  for (const a of m.attachments.filter((a) => isImage(a.path)).slice(0, 4)) {
    try { imgs.push({ type: "image_url", image_url: { url: `data:${mimeOf(a.path)};base64,${(await fs.readFile(resolvePath(a.path, full))).toString("base64")}` } }); } catch {}
  }
  return imgs.length ? [{ type: "text", text }, ...imgs] : text;
}

export async function buildHistory(conv: Conv, all: Msg[], leafId: string, threadOf: string | null, st: Settings, budget: number): Promise<OAMsg[]> {
  const full = st.access === "full";
  let msgs: Msg[];
  const pre: OAMsg[] = [];
  if (threadOf) {
    const anchor = all.find((m) => m.id === threadOf);
    msgs = chain(all, leafId);
    if (anchor) pre.push({ role: "user", content: `[Side thread about this earlier reply. Stay focused on it.]\n${assistantText(anchor).slice(0, 5000)}` }, { role: "assistant", content: "Understood." });
  } else {
    msgs = chain(all, leafId);
    const i = conv.summaryUpTo ? msgs.findIndex((m) => m.id === conv.summaryUpTo) : -1;
    if (i >= 0 && conv.summary) { msgs = msgs.slice(i + 1); pre.push({ role: "user", content: `[Summary of earlier conversation]\n${conv.summary}` }, { role: "assistant", content: "Noted." }); }
  }
  const out: OAMsg[] = [];
  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
    out.push(m.role === "user" ? { role: "user", content: await userContent(m, k === msgs.length - 1, full) } : { role: "assistant", content: assistantText(m) || "(no text)" });
  }
  // budget trim: drop oldest pairs
  const size = (x: OAMsg[]) => x.reduce((a, m) => a + est(typeof m.content === "string" ? m.content : JSON.stringify(m.content).slice(0, 4000)), 0);
  while (out.length > 2 && size(out) + size(pre) > budget) out.splice(0, 2);
  return [...pre, ...out];
}

async function complete(st: Settings, msgs: OAMsg[], max = 1200) {
  const r = await fetch(st.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.apiKey}` },
    body: JSON.stringify({ model: st.model, messages: msgs, max_tokens: max }),
  });
  const j = await r.json();
  return (j.choices?.[0]?.message?.content as string) || "";
}

export async function compactConversation(conv: Conv, all: Msg[], leafId: string, st: Settings) {
  const msgs = chain(all, leafId);
  const text = msgs.map((m) => `${m.role.toUpperCase()}: ${m.role === "user" ? m.content : assistantText(m)}`).join("\n\n").slice(-60000);
  const prior = conv.summary ? `Previous summary:\n${conv.summary}\n\n` : "";
  const summary = await complete(st, [{ role: "user", content: `${prior}Compress this conversation into a dense summary for an AI to continue it. Keep: user goals, decisions, facts, numbers, file paths created/edited, open tasks, tool results that matter. Bullet points, no prose.\n\n${text}` }]);
  if (summary) await db.update(conversations).set({ summary, summaryUpTo: leafId }).where(eq(conversations.id, conv.id));
  return summary || "compaction failed";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "canvas";

export async function runAgent(opts: { conv: Conv; assistantId: string; parentId: string; threadOf: string | null; emit: Emit; signal: AbortSignal }) {
  await ensureWorkspace();
  const { assistantId, parentId, threadOf, emit, signal } = opts;
  let conv = opts.conv;
  const st = await getSettings();
  const budget = Math.max(6000, st.contextTokens - 2500);
  const all = await db.select().from(messages).where(eq(messages.conversationId, conv.id));

  // @mentions pull files into context once
  const parent = all.find((m) => m.id === parentId);
  if (parent?.role === "user") {
    const mentioned = [...parent.content.matchAll(/@([\w./~-]+\.[\w]+|[\w-]+\/[\w./-]+)/g)].map((x) => x[1]);
    const add: string[] = [];
    for (const p of [...mentioned, ...parent.attachments.filter((a) => !isImage(a.path)).map((a) => a.path)]) {
      try { await fs.access(resolvePath(p, st.access === "full")); if (!conv.context.includes(p) && !add.includes(p)) add.push(p); } catch {}
    }
    if (add.length) {
      conv = { ...conv, context: [...conv.context, ...add] };
      await db.update(conversations).set({ context: conv.context }).where(eq(conversations.id, conv.id));
      emit({ t: "context", context: conv.context });
    }
  }

  const vars = { ...st.secrets };
  const mcp = await mcpTools(vars);
  if (mcp.errors.length) emit({ t: "notice", text: "MCP: " + mcp.errors.join("; ") });
  const tools: ToolDef[] = [
    ...CORE_TOOLS,
    ...mcp.tools.map((t) => ({ type: "function" as const, function: { name: `mcp__${t.server}__${t.name}`.slice(0, 64), description: (t.description || "").slice(0, 300), parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} } } })),
  ];

  const parts: Part[] = [];
  const pushText = (d: string) => { const l = parts[parts.length - 1]; if (l?.type === "text") l.text += d; else parts.push({ type: "text", text: d }); };
  const ctx = {
    settings: st, conversationId: conv.id, pinned: conv.context,
    setPinned: async (p: string[]) => { ctx.pinned = p; conv = { ...conv, context: p }; await db.update(conversations).set({ context: p }).where(eq(conversations.id, conv.id)); emit({ t: "context", context: p }); },
    compact: async () => compactConversation(conv, all, parentId, st),
  };

  let sys = await systemPrompt(conv, st, [...new Set(mcp.tools.map((t) => t.server))], budget);
  const history = await buildHistory(conv, all, parentId, threadOf, st, budget - est(sys));
  const loopMsgs: OAMsg[] = [];

  try {
    for (let step = 0; step < 10; step++) {
      const res = await fetch(st.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.apiKey}` },
        body: JSON.stringify({ model: st.model, stream: true, messages: [{ role: "system", content: sys }, ...history, ...loopMsgs], tools }),
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
            calls[i] ??= { id: tc.id || `call_${i}_${Date.now()}`, type: "function", function: { name: "", arguments: "" } };
            if (tc.id) calls[i].id = tc.id;
            if (tc.function?.name) calls[i].function.name += tc.function.name;
            if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
            if (tc.extra_content) calls[i].extra_content = tc.extra_content;
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
      if (valid.some((c) => c.function.name === "context_add" || c.function.name === "context_remove")) sys = await systemPrompt(conv, st, [...new Set(mcp.tools.map((t) => t.server))], budget);
    }
  } catch (e) {
    if (!signal.aborted) { const msg = e instanceof Error ? e.message : String(e); pushText(`\n\n> ${msg}`); emit({ t: "error", text: msg }); }
  }

  const content = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  await db.insert(messages).values({ id: assistantId, conversationId: conv.id, parentId, threadOf, role: "assistant", content, parts });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conv.id));

  // persist canvases as artifacts
  for (const m of content.matchAll(/<canvas\s+title="([^"]*)"[^>]*>([\s\S]*?)<\/canvas>/g)) {
    const f = path.join(WS, "artifacts", slug(m[1]) + ".ui");
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, m[2].trim());
    emit({ t: "artifact", path: "artifacts/" + slug(m[1]) + ".ui" });
  }
  // mirror chat into workspace
  const fresh = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
  await fs.mkdir(path.join(WS, "chats"), { recursive: true });
  await fs.writeFile(path.join(WS, "chats", `${conv.id}.json`), JSON.stringify({ conversation: conv, messages: fresh }, null, 1)).catch(() => {});
}
