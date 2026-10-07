import { db } from "@/db";
import { conversations, messages, Part } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Settings } from "./settings";
import { complete, est } from "./llm";

/**
 * Context economics. Everything the model sees is accounted here, and every heavy piece can be
 * compacted selectively instead of summarising the whole chat:
 *   tools    -> old tool outputs become one-liners (deterministic, zero tokens spent)
 *   web      -> old web_search/web_fetch outputs become 1–2 lines of key facts (one cheap LLM call)
 *   messages -> chosen turns are summarised into one note (LLM), the rest of the chat untouched
 *   history  -> everything except the last N messages becomes a rolling summary (LLM)
 * All of it is reversible (restore) because originals are never deleted.
 */

export type Msg = typeof messages.$inferSelect;
export type Conv = typeof conversations.$inferSelect;
type ToolPart = Extract<Part, { type: "tool" }>;

export function chain(all: Msg[], leafId: string | null): Msg[] {
  const by = new Map(all.map((m) => [m.id, m]));
  const out: Msg[] = [];
  let cur = leafId ? by.get(leafId) : undefined;
  while (cur) { out.unshift(cur); cur = cur.parentId ? by.get(cur.parentId) : undefined; }
  return out;
}

const WEB = new Set(["web_search", "web_fetch", "web_extract"]);
const oneLine = (s: string, n: number) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const argLine = (p: ToolPart) => { const a = p.args || {}; const v = a.path ?? a.query ?? a.url ?? a.command ?? a.name ?? a.target ?? ""; return oneLine(Array.isArray(v) ? v.join(" ") : String(v), 90); };

/** How a tool call appears in history. Compacted parts are one line. */
export function toolText(p: ToolPart, short = false) {
  if (p.compact !== undefined) return `[${p.name} ${argLine(p)} → ${p.compact}]`;
  if (short) return `[${p.name} ${argLine(p)} → ${deterministicSummary(p) || oneLine(p.result || "", 100)}]`;
  return `[${p.name}(${JSON.stringify(p.args).slice(0, 160)}) -> ${oneLine(p.result || "", 600)}]`;
}
export function assistantText(m: Msg, short = false) {
  // reasoning is never re-sent: it is large, and replaying it degrades later answers
  const hasText = m.parts.some((p) => p.type === "text" && p.text.trim());
  return m.parts.map((p) => p.type === "text" ? p.text : p.type === "tool" ? toolText(p, short) : p.type === "workflow" && !hasText ? `[workflow ${p.title}: ${p.input}]` : "").filter(Boolean).join("\n");
}
export function toolTokens(m: Msg) {
  return m.parts.reduce((a, p) => a + (p.type === "tool" ? est(toolText(p)) : 0), 0);
}

function deterministicSummary(p: ToolPart) {
  if (p.ok === false) return "failed";
  const meta = p.meta as { sources?: { title: string }[]; path?: string } | undefined;
  if (p.name === "web_search" && meta?.sources) return `${meta.sources.length} results: ${meta.sources.slice(0, 3).map((s) => oneLine(s.title, 40)).join("; ")}`;
  if (p.name.startsWith("fs_write") || p.name === "fs_edit") return "done";
  return oneLine(p.result || "ok", 80);
}

async function saveParts(m: Msg) { await db.update(messages).set({ parts: m.parts }).where(eq(messages.id, m.id)); }

/** Deterministic tool compaction; keeps the last `keepLast` messages intact. Returns number of parts compacted. */
export async function compactTools(path: Msg[], opts: { webOnly?: boolean; keepLast?: number } = {}) {
  const keep = opts.keepLast ?? 2;
  let n = 0;
  for (const m of path.slice(0, Math.max(0, path.length - keep))) {
    if (m.role !== "assistant") continue;
    let changed = false;
    for (const p of m.parts) {
      if (p.type !== "tool" || p.compact !== undefined) continue;
      if (opts.webOnly && !WEB.has(p.name)) continue;
      p.compact = deterministicSummary(p); changed = true; n++;
    }
    if (changed) await saveParts(m);
  }
  return n;
}

/** Web compaction: replace old web outputs with key facts (single batched LLM call, deterministic fallback). */
export async function compactWeb(path: Msg[], st: Settings, keepLast = 2) {
  const targets: { m: Msg; p: ToolPart }[] = [];
  for (const m of path.slice(0, Math.max(0, path.length - keepLast))) for (const p of m.parts) if (p.type === "tool" && WEB.has(p.name) && p.compact === undefined && p.ok !== false) targets.push({ m, p });
  if (!targets.length) return 0;
  let facts: string[] = [];
  try {
    const items = targets.map((t, i) => `#${i} ${t.p.name} ${argLine(t.p)}\n${(t.p.result || "").slice(0, 3000)}`).join("\n\n");
    const r = await complete(st, [{ role: "user", content: `For each numbered web result, write the key facts worth remembering (numbers, names, dates, claims, source), max 2 lines each. Output a JSON array of strings, same order, nothing else.\n\n${items}` }], 900);
    facts = JSON.parse(r.replace(/^[^[]*/, "").replace(/[^\]]*$/, ""));
  } catch { /* fall back */ }
  const touched = new Set<Msg>();
  targets.forEach((t, i) => { t.p.compact = typeof facts[i] === "string" && facts[i].trim() ? oneLine(facts[i], 320) : deterministicSummary(t.p); touched.add(t.m); });
  for (const m of touched) await saveParts(m);
  return targets.length;
}

const transcript = (ms: Msg[]) => ms.map((m) => `${m.role.toUpperCase()}: ${m.role === "user" ? m.content : assistantText(m)}`).join("\n\n");
const SUMMARY_PROMPT = "Compress into a dense summary for an AI continuing this chat. Keep: user goals, decisions, facts, numbers, file paths created/edited, open tasks, tool results that matter, user preferences. Terse bullets, no prose, no preamble.";

/** Summarise specific messages into one note; the first keeps the summary, the rest fold into it. */
export async function compactMessages(path: Msg[], ids: string[], st: Settings) {
  const sel = path.filter((m) => ids.includes(m.id) && m.compact === null);
  if (!sel.length) return 0;
  const summary = await complete(st, [{ role: "user", content: `${SUMMARY_PROMPT}\n\n${transcript(sel).slice(-60000)}` }], 700);
  if (!summary.trim()) throw new Error("empty summary");
  await db.update(messages).set({ compact: summary.trim() }).where(eq(messages.id, sel[0].id));
  for (const m of sel.slice(1)) await db.update(messages).set({ compact: "" }).where(eq(messages.id, m.id));
  return sel.length;
}

/** Rolling summary of everything except the last `keepLast` messages. */
export async function compactHistory(conv: Conv, path: Msg[], st: Settings, keepLast = 4) {
  if (path.length <= keepLast) return "nothing to compact";
  const cut = path[path.length - keepLast - 1];
  const start = conv.summaryUpTo ? path.findIndex((m) => m.id === conv.summaryUpTo) + 1 : 0;
  const slice = path.slice(Math.max(0, start), path.length - keepLast);
  const prior = conv.summary ? `Previous summary:\n${conv.summary}\n\n` : "";
  const summary = await complete(st, [{ role: "user", content: `${prior}${SUMMARY_PROMPT}\n\n${transcript(slice).slice(-60000)}` }]);
  if (!summary.trim()) return "compaction failed";
  await db.update(conversations).set({ summary: summary.trim(), summaryUpTo: cut.id }).where(eq(conversations.id, conv.id));
  return summary.trim();
}

export async function restoreAll(convId: string) {
  const all = await db.select().from(messages).where(eq(messages.conversationId, convId));
  for (const m of all) {
    const had = m.parts.some((p) => p.type === "tool" && p.compact !== undefined);
    if (had) m.parts.forEach((p) => { if (p.type === "tool") delete p.compact; });
    if (had || m.compact !== null) await db.update(messages).set({ parts: m.parts, compact: null }).where(eq(messages.id, m.id));
  }
  await db.update(conversations).set({ summary: null, summaryUpTo: null }).where(eq(conversations.id, convId));
}

export type CtxSection = { key: string; label: string; tokens: number; items?: { path: string; tokens: number }[] };
export type CtxReport = { budget: number; window: number; total: number; sections: CtxSection[]; turns: { id: string; role: string; preview: string; tokens: number; tools: number; compacted: boolean }[] };

export function turnReport(path: Msg[], conv: Conv) {
  const cutIdx = conv.summaryUpTo ? path.findIndex((m) => m.id === conv.summaryUpTo) : -1;
  return path.map((m, i) => ({
    id: m.id, role: m.role,
    preview: oneLine(m.role === "user" ? m.content : m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ") || m.parts.filter((p) => p.type === "tool").map((p) => (p as ToolPart).name).join(", "), 70),
    tokens: est(m.role === "user" ? m.content : assistantText(m)), tools: m.role === "assistant" ? toolTokens(m) : 0,
    compacted: i <= cutIdx || m.compact !== null,
  }));
}
