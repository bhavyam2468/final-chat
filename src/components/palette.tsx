"use client";
/* The omnibox palette: the input bar expanding into the whole app.
   Typing "/" lists commands; picking a navigational one (/chats, /workspace, /settings, /processes…)
   turns the input itself into that surface's search field — arrow keys move, Right drills in
   (folders, then per-file actions), Left backs out, Enter acts, Esc collapses back to the message.
   Settings work the same way: /settings (or /model) browses the real settings; rows toggle on Enter,
   and value rows hand the input bar over for typing (Enter saves, Esc cancels).
   It is not a second mode of the app: every list here is the same data the mouse panels show. */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Hash, FileText, MessageSquare, Folder, FolderOpen, AppWindow, Link2, Settings2, SquareTerminal, BookOpen,
  Layers, Trash2, Pin, PinOff, Zap, RotateCw, Plus, Monitor, CornerLeftUp, ChevronRight, Check, X, KeyRound, Wrench, Shield, Plug,
  MessageSquareQuote, Globe, ListChecks, Bug, Hammer, GraduationCap, PenLine, } from "lucide-react";
import { CanvasSpec, ProcInfo, TreeNode, flatFiles, useApp } from "./ctx";
import { chatDir } from "@/lib/shared";
import type { ConvItem } from "./Panels";
import { ModeDef, ModeId, DEFAULT_MODE, modeOf } from "@/lib/modes";

export type PaletteMode = "commands" | "modes" | "chats" | "workspace" | "files" | "artifacts" | "sources" | "settings" | "processes" | "skills";
export type PaletteTab = "model" | "tools" | "access" | "mcp" | "skills";
/** one glyph per mode, so the picker reads at a glance */
const MODE_ICON: Record<ModeId, typeof FileText> = {
  chat: MessageSquareQuote, search: Globe, plan: ListChecks, debug: Bug, build: Hammer, learn: GraduationCap, write: PenLine,
};
export type PaletteCommand = { name: string; hint: string; panel?: Exclude<PaletteMode, "commands">; seed?: string; run?: (arg?: string) => void };

export type PaletteApi = {
  commands: PaletteCommand[];
  convs: ConvItem[];
  runningIds: string[];
  sources: { url: string; title: string; snippet?: string }[];
  procs: ProcInfo[];
  recent: CanvasSpec[];
  hostTerm: boolean;
  openChat: (id: string, msg?: string) => void;
  deleteChat: (id: string) => void;
  /** insert "@path " into the message (files mode) */
  mention: (path: string) => void;
  /** put a workspace file onto the composer as an attachment chip */
  attachPath: (path: string) => void;
  /** mode picker (/mode): the registry plus what this chat is currently running */
  modes: ModeDef[];
  activeMode: ModeId;
  setMode: (id: ModeId) => void;
};

type Row = {
  key: string; icon: typeof FileText; label: string; hint?: string; group?: string;
  act: () => void; drill?: () => void; dim?: boolean; live?: boolean; danger?: boolean;
};

type SetPack = {
  s: Record<string, any>;
  presets: Record<string, { baseUrl: string; model: string; contextTokens?: number }>;
  caps: { bwrap: boolean; soffice: boolean; home: string; workspace: string; platform: string; locked: boolean } | null;
};
type Entry = { key: string; label: string; prev: string; secret?: boolean; commit: (v: string) => void };
const SET_SECS = ["model", "tools", "access", "secrets", "mcp"];

const findNode = (ns: TreeNode[], path: string): TreeNode | null => {
  for (const n of ns) { if (n.path === path) return n; if (n.dir && path.startsWith(n.path + "/")) { const f = findNode(n.children || [], path); if (f) return f; } }
  return null;
};
const fileActs = (path: string, app: ReturnType<typeof useApp>, api: PaletteApi, after: () => void, mentionInstead = false): Row[] => {
  const pinned = app.context.includes(path);
  const rows: Row[] = [];
  if (mentionInstead) rows.push({ key: "mention", icon: MessageSquare, label: "Mention in message", hint: "@" + path, act: () => { api.mention(path); after(); } });
  rows.push({ key: "open", icon: FileText, label: "Open in a window", hint: path, act: () => { app.openFile(path); after(); } });
  rows.push({ key: "pin", icon: pinned ? PinOff : Pin, label: pinned ? "Remove from context" : "Pin into context", hint: "stays with every message", act: () => { app.toggleContext(path); after(); } });
  if (!mentionInstead) rows.push({ key: "mention", icon: MessageSquare, label: "Mention in message", hint: "@" + path, act: () => { api.mention(path); after(); } });
  rows.push({ key: "attach", icon: Layers, label: "Attach to message", act: () => { api.attachPath(path); after(); } });
  return rows;
};

export type PaletteHandle = { key: (e: React.KeyboardEvent) => boolean; reset: () => void; entering: () => boolean };

export const Palette = forwardRef<PaletteHandle, {
  mode: PaletteMode; query: string; arg?: string; api: PaletteApi; collapse: (clear?: boolean) => void; onPanel: (m: PaletteMode, seed?: string) => void;
  /** put text into the input bar (settings value entry hands the bar over and takes it back) */
  setInput?: (t: string) => void;
}>(function Palette({ mode, query, arg, api, collapse, onPanel, setInput }, ref) {
  const app = useApp();
  const [idx, setIdx] = useState(0);
  const [cwd, setCwd] = useState<string | null>(null); // null = follow the chat (same rule as WorkspacePanel)
  const [acts, setActs] = useState<Row[] | null>(null);
  const [actsTitle, setActsTitle] = useState("");
  const [hits, setHits] = useState<{ convId: string; title: string; messageId: string; snippet: string }[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string; requires?: string; builtin?: boolean }[] | null>(null);
  // settings browser: section level + a value-entry that borrows the input bar
  const [sec, setSec] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [set, setSet] = useState<SetPack | null>(null);
  const [mcp, setMcp] = useState<Record<string, { url?: string; command?: string; args?: string[]; enabled: boolean }> | null>(null);
  const [mkt, setMkt] = useState<{ mcp?: { id: string; title: string; description?: string; oauth?: boolean; installed?: boolean; missingBin?: string }[] } | null>(null);
  const [pick, setPick] = useState<{ source: string; available: string[] } | null>(null);
  const [pendSecret, setPendSecret] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // each mode opens fresh
  useEffect(() => { setIdx(0); setActs(null); setHits([]); setSec(null); setEntry(null); setPick(null); setPendSecret(null); }, [mode]);
  useEffect(() => { setIdx(0); }, [query, cwd]);
  // /settings model — a command can seed the section directly
  useEffect(() => { if (mode === "settings") setSec(arg && SET_SECS.includes(arg) ? arg : null); }, [mode, arg]);
  // Typing re-filters the list: the highlight goes back to the first match, so Enter always means
  // "the top row of what I see". Without this, a row that happened to be under the pointer keeps the
  // cursor and Enter picks something the user never looked at.
  useEffect(() => { setIdx(0); }, [query, mode]);
  // chats: full-text matches ride along under the title matches
  useEffect(() => {
    if (mode !== "chats" || query.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(query.trim())}`).then((r) => r.json()).then((j) => Array.isArray(j) && setHits(j.slice(0, 6))).catch(() => {}), 180);
    return () => clearTimeout(t);
  }, [mode, query]);
  useEffect(() => {
    if (mode !== "skills" || skills) return;
    fetch("/api/skills").then((r) => r.json()).then((j) => Array.isArray(j) && setSkills(j)).catch(() => setSkills([]));
  }, [mode, skills]);
  useEffect(() => {
    if (mode !== "settings" || set) return;
    fetch("/api/settings").then((r) => r.json()).then((j) => setSet({ s: j.settings, presets: j.presets, caps: j.caps || null })).catch(() => {});
  }, [mode, set]);
  useEffect(() => {
    if (mode !== "settings" || sec !== "mcp" || mcp) return;
    fetch("/api/mcp").then((r) => r.json()).then(setMcp).catch(() => setMcp({}));
    fetch("/api/market").then((r) => r.json()).then(setMkt).catch(() => {});
  }, [mode, sec, mcp]);
  useEffect(() => { const el = listRef.current?.querySelector(`[data-i="${idx}"]`); el?.scrollIntoView({ block: "nearest" }); }, [idx]);

  const q = query.trim().toLowerCase();
  const dir = cwd === null ? (app.convId ? chatDir(app.convId) : "") : cwd;

  const saveS = async (patch: Record<string, unknown>) => {
    const r = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(patch) }).then((x) => x.json()).catch(() => null);
    if (r?.settings) setSet((old) => (old ? { ...old, s: r.settings } : old));
  };
  const putMcp = async (next: Record<string, unknown>) => { setMcp(next as typeof mcp); await fetch("/api/mcp", { method: "PUT", body: JSON.stringify(next) }).catch(() => {}); };
  const refetchMcp = () => { setMcp(null); };
  /** borrow the input bar for typing a value; Enter commits, Esc restores the previous text */
  const startEntry = (key: string, label: string, commit: (v: string) => void, secret = false) =>
    setEntry({ key, label, prev: query, secret, commit });

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (mode === "modes") {
      // The picker: one row per mode, the active one marked. Filtering is plain text (the palette's query).
      for (const m of api.modes) {
        if (q && !m.id.startsWith(q) && !m.label.includes(q) && !m.hint.toLowerCase().includes(q)) continue;
        const on = m.id === api.activeMode;
        out.push({
          key: m.id, icon: MODE_ICON[m.id] || Hash, label: m.label, hint: on ? "current mode" : m.hint, live: on,
          act: () => { api.setMode(m.id); collapse(true); },
        });
      }
      return out;
    }
    if (mode === "commands") {
      for (const c of api.commands) {
        if (q && !c.name.startsWith(q) && !c.hint.toLowerCase().includes(q)) continue;
        out.push({ key: c.name, icon: c.panel ? ChevronRight : Hash, label: "/" + c.name, hint: c.hint, act: () => c.panel ? onPanel(c.panel, c.seed ?? (arg || undefined)) : (collapse(), c.run?.(arg || undefined)), drill: c.panel ? () => onPanel(c.panel!, c.seed ?? (arg || undefined)) : undefined });
      }
      return out;
    }
    if (mode === "chats") {
      for (const c of api.convs) {
        if (q && !(c.title || "").toLowerCase().includes(q)) continue;
        out.push({
          key: c.id, icon: MessageSquare, label: c.title || "Untitled", hint: c.id === app.convId ? "this chat" : c.mode === "general" ? "general" : undefined,
          live: api.runningIds.includes(c.id), act: () => { api.openChat(c.id); collapse(); },
          drill: () => { app.openCanvas({ kind: "chat", id: c.id, title: c.title || "Chat" }); collapse(); },
        });
      }
      for (const h of hits.filter((h) => !out.some((r) => r.key === h.convId))) out.push({ key: "hit" + h.messageId, icon: FileText, label: h.title || "Untitled", hint: h.snippet, group: out.length && !q ? undefined : "Matching messages", act: () => { api.openChat(h.convId, h.messageId); collapse(); }, drill: () => { app.openCanvas({ kind: "chat", id: h.convId, title: h.title || "Chat" }); collapse(); } });
      return out.slice(0, 40);
    }
    if (mode === "workspace" || mode === "files") {
      if (mode === "files") {
        const pool = flatFiles(app.tree).filter((f) => !f.path.startsWith("chats/") || (app.convId && f.path.startsWith(chatDir(app.convId))));
        for (const f of pool) {
          if (q && !f.path.toLowerCase().includes(q)) continue;
          out.push({ key: f.path, icon: FileText, label: f.name, hint: f.path, act: () => { api.mention(f.path); collapse(); }, drill: () => { setActs(fileActs(f.path, app, api, () => setActs(null), true)); setActsTitle(f.name); } });
          if (out.length >= 30) break;
        }
        return out;
      }
      const node = dir ? findNode(app.tree, dir) : null;
      const kids = dir === "" ? app.tree : node?.dir ? node.children || [] : [];
      if (dir) out.push({ key: "..", icon: CornerLeftUp, label: "..", hint: dir.split("/").slice(0, -1).join("/") || "workspace", act: () => setCwd(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ""), drill: () => setCwd(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "") });
      for (const n of [...kids].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))) {
        if (n.dir) {
          const chatId = /^chats\/[\w-]+$/.test(n.path) ? n.name : null;
          out.push({ key: n.path, icon: chatId ? MessageSquare : Folder, label: chatId ? app.convTitles[chatId] || chatId : n.name, hint: "folder", act: () => setCwd(n.path), drill: () => setCwd(n.path) });
        } else {
          out.push({ key: n.path, icon: FileText, label: n.name, hint: n.size ? Math.max(1, Math.round(n.size / 1024)) + " kB" : undefined, act: () => { app.openFile(n.path); collapse(); }, drill: () => { setActs(fileActs(n.path, app, api, () => setActs(null))); setActsTitle(n.name); } });
        }
      }
      return out.slice(0, 60);
    }
    if (mode === "artifacts") {
      for (const s of api.recent) out.push({ key: "r" + JSON.stringify(s).slice(0, 80), icon: AppWindow, label: s.title, hint: "recent window", group: out.length === 0 ? "Recent windows" : undefined, act: () => { app.openCanvas(s); collapse(); } });
      const built = flatFiles(app.tree).filter((f) => /^(chats\/[\w-]+\/)?artifacts\//.test(f.path) && !f.path.includes("node_modules") && !/\.(css|js|json|map)$/.test(f.path));
      for (const f of built) {
        if (q && !f.path.toLowerCase().includes(q)) continue;
        const m = f.path.match(/^chats\/([\w-]+)\/artifacts\/(.*)$/);
        out.push({ key: f.path, icon: AppWindow, label: m ? m[2] : f.path.replace(/^artifacts\//, ""), hint: m && m[1] !== app.convId ? app.convTitles[m[1]] || m[1] : undefined, act: () => { app.openFile(f.path); collapse(); } });
      }
      return out.slice(0, 50);
    }
    if (mode === "sources") {
      for (const [i, s] of api.sources.entries()) {
        if (q && !(s.title + " " + s.url).toLowerCase().includes(q)) continue;
        let host = ""; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
        out.push({ key: s.url + i, icon: Link2, label: s.title || s.url, hint: host, act: () => { app.openCanvas({ kind: "web", url: s.url, title: s.title || s.url }); collapse(); } });
      }
      return out;
    }
    if (mode === "settings") {
      if (!set) return [{ key: "loading", icon: Settings2, label: "Loading settings…", act: () => {} }];
      const s = set.s, caps = set.caps;
      const tog = (key: string, label: string, on: boolean, run: () => void, hint?: string, dim = false): Row =>
        ({ key, icon: on ? Check : X, label, hint: hint ?? (on ? "on" : "off"), act: () => { if (!dim) run(); }, dim });
      if (!sec) {
        const secs: [string, string, string, typeof FileText][] = [
          ["model", "Model", "provider, model, key, context budget", Settings2],
          ["tools", "Tools", "search, quality guard, tool loading, secrets", Wrench],
          ["access", "Access", "files, host terminal, sudo, phone", Shield],
          ["secrets", "Secrets", "SUDO_PASSWORD, API keys for MCP", KeyRound],
          ["mcp", "MCP", "connect servers and sign in", Plug],
        ];
        for (const [name, label, hint, icon] of secs) {
          if (q && !label.toLowerCase().includes(q)) continue;
          out.push({ key: name, icon, label, hint, act: () => { setSec(name); setIdx(0); }, drill: () => { setSec(name); setIdx(0); } });
        }
        out.push({ key: "skills", icon: BookOpen, label: "Skills", hint: "installed skills, install from GitHub", act: () => onPanel("skills"), drill: () => onPanel("skills") });
        return out;
      }
      if (sec === "model") {
        out.push({ key: "provider", icon: Settings2, label: "Provider", hint: String(s.provider || ""), drill: () => { setActs(setPresets(set, s, saveS)); setActsTitle("Provider"); }, act: () => { setActs(setPresets(set, s, saveS)); setActsTitle("Provider"); } });
        out.push({ key: "baseUrl", icon: Link2, label: "Base URL", hint: String(s.baseUrl || "not set"), act: () => startEntry("baseUrl", "Base URL", (v) => v && saveS({ baseUrl: v })) });
        out.push({ key: "apiKey", icon: KeyRound, label: "API key", hint: s.apiKey ? "saved (" + String(s.apiKey).slice(-4) + ")" : "not set", act: () => startEntry("apiKey", "API key", (v) => v && !v.startsWith("••••") && saveS({ apiKey: v }), true) });
        out.push({ key: "model", icon: FileText, label: "Model", hint: String(s.model || "not set"), act: () => startEntry("model", "Model", (v) => v && saveS({ model: v })) });
        out.push({ key: "contextTokens", icon: Layers, label: "Context window", hint: Number(s.contextTokens).toLocaleString() + " tokens", act: () => startEntry("contextTokens", "Context window (tokens)", (v) => { const n = Number(v.replace(/[_,\s]/g, "")); if (n > 0) saveS({ contextTokens: n }); }) });
        out.push({ key: "workingTokens", icon: Layers, label: "Working context per request", hint: Number(s.workingTokens).toLocaleString() + " tokens", act: () => startEntry("workingTokens", "Working context (tokens)", (v) => { const n = Number(v.replace(/[_,\s]/g, "")); if (n > 0) saveS({ workingTokens: n }); }) });
        out.push(tog("vision", "Vision", !!s.vision, () => saveS({ vision: !s.vision })));
        return out;
      }
      if (sec === "tools") {
        out.push({ key: "searxngUrl", icon: Link2, label: "Local SearXNG URL", hint: s.searxngUrl ? String(s.searxngUrl) : "not set", act: () => startEntry("searxngUrl", "SearXNG URL", (v) => saveS({ searxngUrl: v.trim() })) });
        out.push(tog("searxng", "Local-first web search", !!s.searxngUrl, () => saveS({ searxngUrl: s.searxngUrl ? "" : "http://localhost:8080" })));
        out.push(tog("firecrawl", "Firecrawl escalation", !!s.firecrawlEnabled, () => saveS({ firecrawlEnabled: !s.firecrawlEnabled })));
        out.push({ key: "firecrawlUrl", icon: Link2, label: "Firecrawl URL", hint: String(s.firecrawlUrl || "not set"), act: () => startEntry("firecrawlUrl", "Firecrawl URL", (v) => v && saveS({ firecrawlUrl: v })) });
        out.push({ key: "firecrawlKey", icon: KeyRound, label: "Firecrawl key", hint: s.firecrawlKey ? "saved" : "not set", act: () => startEntry("firecrawlKey", "Firecrawl key", (v) => v && !v.startsWith("••••") && saveS({ firecrawlKey: v }), true) });
        out.push({ key: "quality", icon: Check, label: "Quality guard", hint: { fix: "check and repair", warn: "check only", off: "off" }[s.quality as string] || "", act: () => { setActs((["fix", "warn", "off"] as const).map((v) => ({ key: v, icon: Check, label: { fix: "Check and repair", warn: "Check only", off: "Off" }[v], act: () => { saveS({ quality: v }); setActs(null); } }))); setActsTitle("Quality guard"); }, drill: () => { setActs((["fix", "warn", "off"] as const).map((v) => ({ key: v, icon: Check, label: { fix: "Check and repair", warn: "Check only", off: "Off" }[v], act: () => { saveS({ quality: v }); setActs(null); } }))); setActsTitle("Quality guard"); } });
        out.push({ key: "toolLoading", icon: Zap, label: "Developer tools", hint: { auto: "auto (on demand below 48k)", lean: "on demand", all: "always loaded" }[s.toolLoading as string] || "", act: () => { setActs((["auto", "lean", "all"] as const).map((v) => ({ key: v, icon: Check, label: { auto: "Auto — on demand below 48k context", lean: "On demand", all: "Always loaded" }[v], act: () => { saveS({ toolLoading: v }); setActs(null); } }))); setActsTitle("Developer tools"); }, drill: () => { setActs((["auto", "lean", "all"] as const).map((v) => ({ key: v, icon: Check, label: { auto: "Auto — on demand below 48k context", lean: "On demand", all: "Always loaded" }[v], act: () => { saveS({ toolLoading: v }); setActs(null); } }))); setActsTitle("Developer tools"); } });
        return out;
      }
      if (sec === "access") {
        const locked = !!caps?.locked;
        out.push(tog("home", "Home folder", s.access !== "sandbox", () => saveS({ access: s.access === "sandbox" ? "home" : "sandbox" }), s.access === "sandbox" ? `off — files stay in ${caps?.workspace || "the workspace"}` : `on — the agent can use ${caps?.home || "~"}`, locked));
        out.push(tog("full", "Entire disk", s.access === "full", () => saveS({ access: s.access === "full" ? "home" : "full" }), s.access === "sandbox" ? "needs home folder first" : "absolute paths outside home", locked || s.access === "sandbox"));
        out.push(tog("host", "Host terminal", s.terminal === "host", () => saveS(s.terminal === "host" ? { terminal: "sandbox", sudo: false, phone: false } : { terminal: "host" }), s.terminal === "host" ? "on — shell runs as you" : caps?.bwrap ? "off — sandboxed with bubblewrap" : "off — sandboxed, secrets stripped", locked));
        out.push(tog("sudo", "Allow sudo", !!s.sudo, () => saveS({ sudo: !s.sudo }), s.terminal !== "host" ? "needs the host terminal" : s.secrets?.SUDO_PASSWORD ? "uses the SUDO_PASSWORD secret" : "passwordless sudo only", locked || s.terminal !== "host"));
        out.push(tog("phone", "Phone testing", !!s.phone, () => saveS({ phone: !s.phone }), s.terminal !== "host" ? "needs the host terminal" : "adb on a plugged-in device", locked || s.terminal !== "host"));
        return out;
      }
      if (sec === "secrets") {
        for (const k of Object.keys(s.secrets || {})) {
          out.push({ key: "s_" + k, icon: KeyRound, label: k, hint: "saved — Enter to change", act: () => startEntry("s_" + k, k, (v) => saveS({ secrets: { [k]: v } }), true) });
        }
        out.push({ key: "add", icon: Plus, label: "Add a secret", hint: pendSecret ? "typing the value…" : "name, then value", act: () => {
          if (pendSecret) { startEntry("add", "Value for " + pendSecret, (v) => { const n = pendSecret; setPendSecret(null); if (v) saveS({ secrets: { [n]: v } }); }, true); }
          else startEntry("add", "Secret name", (v) => { const n = v.trim().toUpperCase().replace(/[^\w-]/g, ""); if (n) { setPendSecret(n); startEntry("add", "Value for " + n, (val) => { setPendSecret(null); if (val) saveS({ secrets: { [n]: val } }); }, true); } });
        } });
        return out;
      }
      if (sec === "mcp") {
        for (const [name, c] of Object.entries(mcp || {})) {
          out.push({
            key: name, icon: Plug, label: name, dim: !c.enabled, live: c.enabled, hint: (c.enabled ? "on · " : "off · ") + (c.url || [c.command, ...(c.args || [])].join(" ")),
            act: () => putMcp({ ...(mcp || {}), [name]: { ...c, enabled: !c.enabled } }),
            drill: () => {
              setActsTitle(name);
              setActs([
                { key: "tog", icon: c.enabled ? X : Check, label: c.enabled ? "Disable" : "Enable", act: () => { putMcp({ ...(mcp || {}), [name]: { ...c, enabled: !c.enabled } }); setActs(null); } },
                ...(c.url ? [{ key: "signin", icon: Link2, label: "Sign in", act: async () => { setActs(null); const r = await fetch("/api/mcp/oauth", { method: "POST", body: JSON.stringify({ name }) }).then((x) => x.json()).catch(() => null); if (r?.url) window.open(r.url, "_blank", "noopener"); else refetchMcp(); } }] : []),
                { key: "rm", icon: Trash2, label: "Remove", danger: true, act: () => { const n = { ...(mcp || {}) }; delete n[name]; putMcp(n); setActs(null); } },
              ]);
            },
          });
        }
        const avail = (mkt?.mcp || []).filter((e) => !e.installed);
        out.push({ key: ":cat", icon: Plus, label: "Add an integration", hint: avail.length ? avail.length + " available" : "catalog", act: () => { setActsTitle("Add an integration"); setActs(avail.map((e) => ({ key: e.id, icon: Plug, label: e.title + (e.oauth ? "  — one-click sign-in" : ""), hint: e.missingBin ? `needs ${e.missingBin}` : e.description, dim: !!e.missingBin, act: async () => { await fetch("/api/market", { method: "POST", body: JSON.stringify({ id: e.id }) }).catch(() => {}); refetchMcp(); setActs(null); } }))); }, drill: () => {
          setActsTitle("Add an integration");
          setActs(avail.map((e) => ({ key: e.id, icon: Plug, label: e.title + (e.oauth ? "  — one-click sign-in" : ""), hint: e.missingBin ? `needs ${e.missingBin}` : e.description, dim: !!e.missingBin, act: async () => { await fetch("/api/market", { method: "POST", body: JSON.stringify({ id: e.id }) }).catch(() => {}); refetchMcp(); setActs(null); } })));
        } });
        out.push({ key: ":custom", icon: Wrench, label: "Custom server", hint: "name = url, or name = command", act: () => startEntry(":custom", "name = url or command", (v) => {
          const m = v.match(/^\s*([\w-]+)\s*=\s*(.+)$/); if (!m) return;
          const val = m[2].trim();
          const srv = /^https?:/.test(val) ? { url: val, enabled: true } : { command: val.split(/\s+/)[0], args: val.split(/\s+/).slice(1), enabled: true };
          putMcp({ ...(mcp || {}), [m[1]]: srv }); refetchMcp();
        }) });
        return out;
      }
      return out;
    }
    if (mode === "processes") {
      out.push({ key: ":new", icon: Plus, label: "New terminal", hint: "sandboxed", act: () => { app.openTerm({}); collapse(); } });
      if (api.hostTerm) out.push({ key: ":host", icon: Monitor, label: "Host terminal", hint: "your machine's real shell", act: () => { app.openTerm({ host: true }); collapse(); } });
      for (const p of api.procs) {
        out.push({
          key: p.name, icon: SquareTerminal, label: p.name, hint: `${p.running ? "running" : `exited ${p.exit}`} · ${p.command.slice(0, 60)}${p.ports.length ? ` · :${p.ports[0]}` : ""}`, dim: !p.running, live: p.running,
          act: () => { app.openTerm({ proc: p.name }); collapse(); },
          drill: () => {
            setActsTitle(p.name);
            setActs([
              { key: "open", icon: SquareTerminal, label: "Open output", act: () => { app.openTerm({ proc: p.name }); collapse(); } },
              ...(p.running ? [{ key: "stop", icon: Trash2, label: "Stop process", danger: true, act: () => { fetch("/api/proc", { method: "POST", body: JSON.stringify({ name: p.name }) }); collapse(); } }] : []),
              { key: "restart", icon: RotateCw, label: "Restart process", act: () => { fetch("/api/proc", { method: "POST", body: JSON.stringify({ name: p.name, action: "restart" }) }); collapse(); } },
            ]);
          },
        });
      }
      return out;
    }
    if (mode === "skills") {
      if (pick) {
        out.push({ key: ":all", icon: Plus, label: `Install all (${pick.available.length})`, hint: pick.source, act: async () => { await fetch("/api/skills", { method: "POST", body: JSON.stringify({ source: pick.source, pick: pick.available }) }); setPick(null); setSkills(null); } });
        for (const n of pick.available) out.push({ key: ":" + n, icon: BookOpen, label: n, hint: pick.source, act: async () => { await fetch("/api/skills", { method: "POST", body: JSON.stringify({ source: pick.source, pick: [n] }) }); setPick(null); setSkills(null); } });
        return out;
      }
      out.push({ key: ":install", icon: Plus, label: "Install from GitHub…", hint: "owner/repo, a path, or a URL", act: () => startEntry(":install", "owner/repo or GitHub URL", (v) => {
        if (!v.trim()) return;
        fetch("/api/skills", { method: "POST", body: JSON.stringify({ source: v.trim() }) }).then((r) => r.json()).then((j) => {
          if (j.error) return;
          if (!j.installed?.length && j.available?.length > 1) setPick({ source: v.trim(), available: j.available });
          else setSkills(null);
        }).catch(() => {});
      }) });
      for (const s of skills || []) {
        if (q && !(s.name + " " + s.description).toLowerCase().includes(q)) continue;
        out.push({
          key: s.name, icon: BookOpen, label: s.name, hint: s.description, act: () => { app.openFile(`system/skills/${s.name}/SKILL.md`); collapse(); },
          drill: () => {
            setActsTitle(s.name);
            setActs([
              { key: "open", icon: FileText, label: "Open SKILL.md", act: () => { app.openFile(`system/skills/${s.name}/SKILL.md`); collapse(); } },
              ...(!s.builtin ? [{ key: "rm", icon: Trash2, label: "Remove skill", danger: true, act: () => { fetch("/api/skills?name=" + encodeURIComponent(s.name), { method: "DELETE" }); setSkills(null); setActs(null); } }] : []),
            ]);
          },
        });
      }
      return out;
    }
    return out;
  }, [mode, q, arg, api, app, hits, skills, dir, collapse, onPanel, sec, set, mcp, mkt, pick, pendSecret, saveS, putMcp, startEntry]);

  // provider presets: a small sub-list built from the server's preset table
  function setPresets(pack: SetPack, s: Record<string, any>, save: (p: Record<string, unknown>) => void): Row[] {
    return Object.keys(pack.presets || {}).map((name) => {
      const p = pack.presets[name];
      return {
        key: name, icon: Settings2, label: name, hint: (s.provider === name ? "current · " : "") + (p.model || "your own values"),
        act: () => save({ provider: name, ...(p.baseUrl ? { baseUrl: p.baseUrl, model: p.model, ...(p.contextTokens ? { contextTokens: p.contextTokens } : {}) } : {}) }),
      };
    });
  }

  const shown = acts || rows;
  if (acts) { /* clamp index into drilled actions */ if (idx >= shown.length) setIdx(0); }

  useImperativeHandle(ref, () => ({
    reset: () => { setIdx(0); setActs(null); },
    entering: () => !!entry,
    key: (e: React.KeyboardEvent) => {
      // a value entry owns the input bar: Enter commits, Esc gives it back untouched
      if (entry) {
        if (e.key === "Enter") { const en = entry; setEntry(null); setInput?.(en.prev); en.commit(query); return true; }
        if (e.key === "Escape") { setEntry(null); setInput?.(entry.prev); return true; }
        return false; // arrows and editing keys belong to the text while entering a value
      }
      if (acts && e.key === "ArrowLeft") { setActs(null); setIdx(0); return true; }
      if (!acts && mode === "settings" && e.key === "ArrowLeft" && sec) { setSec(null); setIdx(0); return true; }
      if (!acts && mode === "workspace" && e.key === "ArrowLeft" && dir) { setCwd(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ""); return true; }
      if (!acts && mode !== "commands" && e.key === "ArrowLeft") { onPanel("commands"); return true; }
      if (e.key === "ArrowDown") { setIdx((i) => (shown.length ? (i + 1) % shown.length : 0)); return true; }
      if (e.key === "ArrowUp") { setIdx((i) => (shown.length ? (i - 1 + shown.length) % shown.length : 0)); return true; }
      if (e.key === "ArrowRight" || e.key === "Tab") { const r = shown[idx]; if (!r) return true; if (r.drill) r.drill(); else r.act(); return true; }
      if (e.key === "Enter") { const r = shown[idx]; if (r) r.act(); return true; }
      return false;
    },
  }), [acts, shown, idx, mode, dir, sec, entry, query, onPanel, setInput]);

  const crumb = acts ? actsTitle
    : entry ? entry.label
    : mode === "modes" ? `mode · ${modeOf(api.activeMode).label === DEFAULT_MODE ? "chat" : modeOf(api.activeMode).label}`
    : mode === "settings" ? (sec ? { model: "Model", tools: "Tools", access: "Access", secrets: "Secrets", mcp: "MCP" }[sec] || sec : "settings")
    : mode === "workspace" ? dir.split("/").pop() || "workspace"
    : mode;
  let lastGroup: string | undefined;
  return (
    <div className="pal" role="listbox" aria-label={mode}>
      <div className="pal-in">
      <div className="pal-head">
        <span className="pal-crumb">{crumb}</span>
        <span className="sp" />
        {mode !== "commands" && <button className="pal-back" onMouseDown={(e) => e.preventDefault()} onClick={() => (entry ? (setEntry(null), setInput?.(entry.prev)) : acts ? setActs(null) : sec ? setSec(null) : onPanel("commands"))}><CornerLeftUp size={12} />back</button>}
      </div>
      <div className="pal-list" ref={listRef}>
        {shown.map((r, i) => {
          const head = r.group && r.group !== lastGroup ? r.group : null;
          lastGroup = r.group || lastGroup;
          const I = r.icon;
          const hint = entry && entry.key === r.key ? (entry.secret ? "type it below — Enter saves, Esc cancels" : "type the new value — Enter saves, Esc cancels") : r.hint;
          return [
            head && <div key={r.key + ":g"} className="pal-group">{head}</div>,
            <button key={r.key} data-i={i} className={"pal-row" + (i === idx ? " on" : "") + (r.dim ? " dim" : "") + (r.danger ? " danger" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setIdx(i); r.act(); }}
              onMouseEnter={() => setIdx(i)}
              onDoubleClick={() => r.drill?.()}>
              <span className="pal-ic"><I />{r.live && <i className="live-dot" />}</span>
              <span className="pal-label">{r.label}</span>
              {hint && <span className="pal-hint">{hint}</span>}
              {r.drill && !entry && <ChevronRight size={12} className="pal-more" />}
            </button>,
          ];
        })}
        {!shown.length && <div className="pal-empty">{mode === "modes" ? "No mode matches" : mode === "processes" ? "No background processes" : mode === "sources" ? "No sources yet" : mode === "skills" ? (skills === null ? "Loading skills…" : "No skills installed") : "Nothing matches"}</div>}
      </div>
      </div>
    </div>
  );
});
