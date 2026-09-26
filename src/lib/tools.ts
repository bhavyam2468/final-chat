import fs from "fs/promises";
import path from "path";
import { WS, resolvePath, rel, tree, Node, mimeOf } from "./workspace";
import type { Settings } from "./settings";
import { searchCatalog } from "./blocks/catalog";
import { callMcp } from "./mcp";
import { runShell, runPython as execPython, pipInstall } from "./exec";
import { youtubeId } from "./shared";

export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
const T = (name: string, description: string, props: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: "function", function: { name, description, parameters: { type: "object", properties: props, required } },
});
const s = (d?: string) => ({ type: "string", ...(d ? { description: d } : {}) });
const n = (d?: string) => ({ type: "number", ...(d ? { description: d } : {}) });

// Descriptions are deliberately terse: tool schemas are sent on every request.
export const CORE_TOOLS: ToolDef[] = [
  T("skill_open", "Load a skill's instructions", { name: s() }, ["name"]),
  T("context_add", "Add file to active context", { path: s() }, ["path"]),
  T("context_remove", "Remove file from active context", { path: s() }, ["path"]),
  T("compact_context", "Free context. tools=fold old tool outputs to one line; web=old web results to key facts; history=summarise all but last keep_last messages", { scope: { type: "string", enum: ["tools", "web", "history"] }, keep_last: n() }),
  T("fs_list", "List directory", { path: s() }),
  T("fs_read", "Read file lines", { path: s(), start: n(), end: n() }, ["path"]),
  T("fs_write", "Write file", { path: s(), content: s(), mode: { type: "string", enum: ["overwrite", "append"] } }, ["path", "content"]),
  T("fs_edit", "Replace exact text in file", { path: s(), find: s(), replace: s(), all: { type: "boolean" } }, ["path", "find", "replace"]),
  T("fs_delete", "Delete file or dir", { path: s() }, ["path"]),
  T("fs_move", "Move/rename", { from: s(), to: s() }, ["from", "to"]),
  T("run_python", "Run python3 code, cwd=workspace", { code: s() }, ["code"]),
  T("pip_install", "Install python packages", { packages: { type: "array", items: { type: "string" } } }, ["packages"]),
  T("shell", "Run bash command", { command: s(), timeout: n("seconds, default 120, max 600") }, ["command"]),
  T("web_search", "Search the web", { query: s(), limit: n() }, ["query"]),
  T("web_fetch", "Fetch URL as markdown", { url: s() }, ["url"]),
  T("web_extract", "Extract structured data from a web page using Firecrawl Cloud AI", { url: s("URL to extract from"), prompt: s("Description or schema of data to extract") }, ["url", "prompt"]),
  T("ui_search", "Find Blocks UI components by tags", { query: s() }, ["query"]),
  T("canvas_open", "Open a workspace file, web page or YouTube URL in a canvas window for the user", { target: s("path or URL"), title: s(), dock: { type: "boolean", description: "open docked beside chat" } }, ["target"]),
];

export type ToolCtx = {
  settings: Settings; conversationId: string; pinned: string[]; emit: (e: Record<string, unknown>) => void;
  setPinned: (p: string[]) => Promise<void>; compact: (scope?: string, keepLast?: number) => Promise<string>;
};
export type ToolOut = { result: string; ok: boolean; meta?: unknown };

const cut = (x: string, n = 8000) => (x.length > n ? x.slice(0, n) + `\n… (${x.length - n} more chars)` : x);

/** Server-side python for Blocks `py()` helper (respects terminal sandbox setting). */
export const runPython = (code: string, st: Settings | null = null) => execPython(st, code);

const listText = (nodes: Node[], ind = ""): string => nodes.map((n) => `${ind}${n.name}${n.dir ? "/" : ` (${n.size ?? 0}b)`}\n${n.children ? listText(n.children, ind + "  ") : ""}`).join("");

function isAntiBotProtected(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("performing security verification") ||
    lower.includes("security service to protect against malicious bots") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("attention required! | cloudflare") ||
    lower.includes("checking your browser before accessing") ||
    lower.includes("just a moment...") ||
    lower.includes("enable javascript and cookies to continue") ||
    lower.includes("datadome")
  );
}

async function firecrawlScrape(st: Settings, url: string) {
  // 1. Try local Firecrawl first (no API key needed, zero credit cost)
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(st.firecrawlUrl.replace(/\/$/, "") + "/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const j = await r.json();
        const md = (j.data?.markdown as string) || "";
        if (!isAntiBotProtected(md) && md.trim().length > 0) {
          return { ...j, _source: "local" };
        }
      }
    } catch {
      // Local failed or timed out, fall back to cloud
    }
  }

  // 2. Fallback to Cloud Firecrawl using API key (bypasses Cloudflare / anti-bot)
  if (st.firecrawlKey) {
    const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/scrape";
    const r = await fetch(cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${st.firecrawlKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ...j, _source: "cloud" };
    throw new Error(`Cloud Firecrawl scrape ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }

  throw new Error("Scrape failed: Local Firecrawl was blocked by anti-bot protection or failed, and no online Firecrawl API key is set for cloud bypass.");
}

async function firecrawlSearch(st: Settings, query: string, limit: number) {
  // 1. Attempt local Firecrawl search with a quick timeout
  if (st.firecrawlUrl) {
    try {
      const r = await fetch(st.firecrawlUrl.replace(/\/$/, "") + "/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.data) && j.data.length > 0) {
          return { ...j, _source: "local" };
        }
      }
    } catch {
      // Local timed out or errored
    }
  }

  // 2. Fallback to Cloud Firecrawl search using API key
  if (st.firecrawlKey) {
    const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/search";
    const r = await fetch(cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${st.firecrawlKey}`,
      },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ...j, _source: "cloud" };
    throw new Error(`Cloud Firecrawl search ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }

  throw new Error("Search failed: Local search timed out/failed and no online Firecrawl API key is set.");
}

async function firecrawlExtract(st: Settings, url: string, prompt: string) {
  // Local Firecrawl does not support AI extraction (requires LLM). Always routes to Cloud with API key.
  if (!st.firecrawlKey) {
    throw new Error("Online Firecrawl API key is required for AI structured extraction (local Firecrawl lacks an AI extraction engine).");
  }

  const cloudEndpoint = (st.firecrawlCloudUrl || "https://api.firecrawl.dev").replace(/\/$/, "") + "/v1/scrape";
  const r = await fetch(cloudEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${st.firecrawlKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["extract"],
      extract: { prompt },
    }),
    signal: AbortSignal.timeout(35000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Firecrawl extract ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data?.extract || j.data || j;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function execTool(name: string, a: Record<string, any>, ctx: ToolCtx): Promise<ToolOut> {
  const full = ctx.settings.access;
  const P = (p: string) => resolvePath(p, full);
  try {
    switch (name) {
      case "skill_open": {
        const f = path.join(WS, "system/skills", String(a.name).replace(/[^\w-]/g, ""), "SKILL.md");
        return { ok: true, result: (await fs.readFile(f, "utf8")).replace(/^---[\s\S]*?---\n/, "") };
      }
      case "context_add": {
        const p = rel(P(a.path)); await fs.access(P(a.path));
        if (!ctx.pinned.includes(p)) await ctx.setPinned([...ctx.pinned, p]);
        return { ok: true, result: `Added ${p}; content visible from next step.` };
      }
      case "context_remove": { await ctx.setPinned(ctx.pinned.filter((x) => x !== a.path)); return { ok: true, result: "Removed " + a.path }; }
      case "compact_context": return { ok: true, result: await ctx.compact(a.scope || "history", Number(a.keep_last) || undefined) };
      case "fs_list": return { ok: true, result: cut(listText(await treeAt(P(a.path || "."))) || "(empty)") };
      case "fs_read": {
        const lines = (await fs.readFile(P(a.path), "utf8")).split("\n");
        const st = Math.max(1, Number(a.start) || 1), en = Math.min(lines.length, Number(a.end) || st + 399);
        return { ok: true, result: cut(lines.slice(st - 1, en).map((l, i) => `${st + i}\t${l}`).join("\n") + (en < lines.length ? `\n… ${lines.length} lines total` : ""), 16000) };
      }
      case "fs_write": {
        const f = P(a.path); await fs.mkdir(path.dirname(f), { recursive: true });
        let before = ""; try { before = await fs.readFile(f, "utf8"); } catch {}
        if (a.mode === "append") await fs.appendFile(f, (before && !before.endsWith("\n") ? "\n" : "") + a.content); else await fs.writeFile(f, a.content);
        return { ok: true, result: `Wrote ${a.path} (${a.content.length} chars)`, meta: { path: a.path, before: a.mode === "append" ? "" : before.slice(0, 20000), after: a.content.slice(0, 20000) } };
      }
      case "fs_edit": {
        const f = P(a.path), src = await fs.readFile(f, "utf8");
        const n = src.split(a.find).length - 1;
        if (!n) return { ok: false, result: "find text not found; fs_read and copy exactly" };
        if (n > 1 && !a.all) return { ok: false, result: `find matches ${n} times; add context or all=true` };
        await fs.writeFile(f, a.all ? src.split(a.find).join(a.replace) : src.replace(a.find, a.replace));
        return { ok: true, result: `Edited ${a.path} (${a.all ? n : 1} replacement)`, meta: { path: a.path, before: a.find, after: a.replace } };
      }
      case "fs_delete": { await fs.rm(P(a.path), { recursive: true, force: true }); return { ok: true, result: "Deleted " + a.path }; }
      case "fs_move": { const to = P(a.to); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.rename(P(a.from), to); return { ok: true, result: `Moved to ${a.to}` }; }
      case "run_python": { const r = await execPython(ctx.settings, a.code); return { ok: r.code === 0, result: cut(r.out || "(no output)") }; }
      case "pip_install": {
        const r = await pipInstall(([] as string[]).concat(a.packages));
        return { ok: r.code === 0, result: cut(r.out || "installed", 3000) };
      }
      case "shell": {
        const r = await runShell(ctx.settings, String(a.command), Math.min(600, Math.max(5, Number(a.timeout) || 120)) * 1000);
        return { ok: r.code === 0, result: cut(`exit ${r.code}\n${r.out}`) };
      }
      case "canvas_open": {
        const t = String(a.target || "").trim();
        const title = a.title ? String(a.title) : undefined;
        const yt = youtubeId(t);
        let spec: Record<string, unknown>;
        if (yt) spec = { kind: "youtube", id: yt, title: title || "YouTube" };
        else if (/^https?:\/\//.test(t)) spec = { kind: "web", url: t, title: title || new URL(t).hostname };
        else { const abs = P(t); await fs.access(abs); spec = { kind: "file", path: rel(abs), title: title || path.basename(abs) }; }
        ctx.emit({ t: "canvas", spec, dock: !!a.dock });
        return { ok: true, result: `Opened ${spec.kind === "file" ? spec.path : t} in canvas` + (spec.kind === "file" ? ` (${mimeOf(t)})` : "") };
      }
      case "web_search": {
        const j = await firecrawlSearch(ctx.settings, a.query, Math.min(Number(a.limit) || 5, 8));
        const items = ((j.data as { url: string; title?: string; description?: string }[]) || []).map((d) => ({ url: d.url, title: d.title || d.url, snippet: (d.description || "").slice(0, 240) }));
        return { ok: true, result: items.map((d, i) => `[${i + 1}] ${d.title}\n${d.url}\n${d.snippet}`).join("\n\n") || "no results", meta: { sources: items, source: j._source } };
      }
      case "web_fetch": {
        const j = await firecrawlScrape(ctx.settings, a.url);
        const md = (j.data?.markdown as string) || "";
        return { ok: true, result: cut(md, 12000), meta: { sources: [{ url: a.url, title: j.data?.metadata?.title || a.url, snippet: md.slice(0, 200) }], source: j._source } };
      }
      case "web_extract": {
        const extracted = await firecrawlExtract(ctx.settings, a.url, String(a.prompt));
        const result = typeof extracted === "string" ? extracted : JSON.stringify(extracted, null, 2);
        return { ok: true, result: cut(result, 12000), meta: { sources: [{ url: a.url, title: a.url, snippet: "Structured extraction" }], source: "cloud" } };
      }
      case "ui_search": return { ok: true, result: searchCatalog(a.query) };
      default: {
        const m = name.match(/^mcp__(.+?)__(.+)$/);
        if (m) return { ok: true, result: cut(await callMcp(m[1], m[2], a), 12000) };
        return { ok: false, result: "Unknown tool " + name };
      }
    }
  } catch (e) {
    return { ok: false, result: "Error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

async function treeAt(abs: string) { return tree(abs, 1); }
