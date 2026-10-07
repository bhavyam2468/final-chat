"use client";
/* The omnibox palette: the input bar expanding into the whole app.
   Typing "/" lists commands; picking a navigational one (/chats, /workspace, /settings, /processes…)
   turns the input itself into that surface's search field — arrow keys move, Right drills in
   (folders, then per-file actions), Left backs out, Enter acts, Esc collapses back to the message.
   It is not a second mode of the app: every list here is the same data the mouse panels show. */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Hash, FileText, MessageSquare, Folder, FolderOpen, AppWindow, Link2, Settings2, SquareTerminal, BookOpen,
  Layers, Trash2, Pin, PinOff, Zap, RotateCw, Plus, Monitor, CornerLeftUp, ChevronRight, } from "lucide-react";
import { CanvasSpec, ProcInfo, TreeNode, flatFiles, useApp } from "./ctx";
import { chatDir } from "@/lib/shared";
import type { ConvItem } from "./Panels";

export type PaletteMode = "commands" | "chats" | "workspace" | "files" | "artifacts" | "sources" | "settings" | "processes" | "skills";
export type PaletteTab = "model" | "tools" | "access" | "mcp" | "skills";
export type PaletteCommand = { name: string; hint: string; panel?: Exclude<PaletteMode, "commands">; run: (arg?: string) => void };

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
  openSettings: (tab?: PaletteTab) => void;
  /** insert "@path " into the message (files mode) */
  mention: (path: string) => void;
  /** put a workspace file onto the composer as an attachment chip */
  attachPath: (path: string) => void;
};

type Row = {
  key: string; icon: typeof FileText; label: string; hint?: string; group?: string;
  act: () => void; drill?: () => void; dim?: boolean; live?: boolean; danger?: boolean;
};

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

export type PaletteHandle = { key: (e: React.KeyboardEvent) => boolean; reset: () => void };

export const Palette = forwardRef<PaletteHandle, {
  mode: PaletteMode; query: string; arg?: string; api: PaletteApi; collapse: () => void; onPanel: (m: PaletteMode, seed?: string) => void;
}>(function Palette({ mode, query, arg, api, collapse, onPanel }, ref) {
  const app = useApp();
  const [idx, setIdx] = useState(0);
  const [cwd, setCwd] = useState<string | null>(null); // null = follow the chat (same rule as WorkspacePanel)
  const [acts, setActs] = useState<Row[] | null>(null);
  const [actsTitle, setActsTitle] = useState("");
  const [hits, setHits] = useState<{ convId: string; title: string; messageId: string; snippet: string }[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string; requires?: string }[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // each mode opens fresh
  useEffect(() => { setIdx(0); setActs(null); setHits([]); }, [mode]);
  useEffect(() => { setIdx(0); }, [query, cwd]);
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
  useEffect(() => { const el = listRef.current?.querySelector(`[data-i="${idx}"]`); el?.scrollIntoView({ block: "nearest" }); }, [idx]);

  const q = query.trim().toLowerCase();
  const dir = cwd === null ? (app.convId ? chatDir(app.convId) : "") : cwd;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (mode === "commands") {
      for (const c of api.commands) {
        if (q && !c.name.startsWith(q) && !c.hint.toLowerCase().includes(q)) continue;
        out.push({ key: c.name, icon: c.panel ? ChevronRight : Hash, label: "/" + c.name, hint: c.hint, act: () => c.panel ? onPanel(c.panel, arg || undefined) : (collapse(), c.run(arg || undefined)), drill: c.panel ? () => onPanel(c.panel!, arg || undefined) : undefined });
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
      const secs: [PaletteTab, string, string, typeof FileText][] = [
        ["model", "Model", "provider, base url, key, context budget", Settings2],
        ["tools", "Tools", "tool loading, vision, quality guard", Zap],
        ["access", "Access", "files, host terminal, sudo, phone", FolderOpen],
        ["mcp", "MCP", "connect servers and sign in", Layers],
        ["skills", "Skills", "installed skills, install from GitHub", BookOpen],
      ];
      for (const [tab, label, hint, icon] of secs) {
        if (q && !label.toLowerCase().includes(q)) continue;
        out.push({ key: tab, icon, label, hint, act: () => { api.openSettings(tab); collapse(); }, drill: () => { api.openSettings(tab); collapse(); } });
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
      for (const s of skills || []) {
        if (q && !(s.name + " " + s.description).toLowerCase().includes(q)) continue;
        out.push({ key: s.name, icon: BookOpen, label: s.name, hint: s.description, act: () => { app.openFile(`system/skills/${s.name}/SKILL.md`); collapse(); }, drill: () => { app.openFile(`system/skills/${s.name}/SKILL.md`); collapse(); } });
      }
      return out;
    }
    return out;
  }, [mode, q, api, app, hits, skills, dir, collapse, onPanel]);

  const shown = acts || rows;
  if (acts) { /* clamp index into drilled actions */ if (idx >= shown.length) setIdx(0); }

  useImperativeHandle(ref, () => ({
    reset: () => { setIdx(0); setActs(null); },
    key: (e: React.KeyboardEvent) => {
      if (acts && e.key === "ArrowLeft") { setActs(null); setIdx(0); return true; }
      if (!acts && mode === "workspace" && e.key === "ArrowLeft" && dir) { setCwd(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ""); return true; }
      if (!acts && mode !== "commands" && e.key === "ArrowLeft") { onPanel("commands"); return true; }
      if (e.key === "ArrowDown") { setIdx((i) => (shown.length ? (i + 1) % shown.length : 0)); return true; }
      if (e.key === "ArrowUp") { setIdx((i) => (shown.length ? (i - 1 + shown.length) % shown.length : 0)); return true; }
      if (e.key === "ArrowRight" || e.key === "Tab") { const r = shown[idx]; if (!r) return true; if (r.drill) r.drill(); else r.act(); return true; }
      if (e.key === "Enter") { const r = shown[idx]; if (r) r.act(); return true; }
      return false;
    },
  }), [acts, shown, idx, mode, dir, onPanel]);

  const hints: [string, string][] = acts
    ? [["←", "back"], ["⏎", "select"]]
    : mode === "commands" ? [["↑↓", "navigate"], ["⏎", "run"], ["→", "browse"], ["esc", "close"]]
    : mode === "workspace" ? [["↑↓", "navigate"], ["→", "open folder · file actions"], ["←", "up / back"], ["⏎", "open"], ["esc", "close"]]
    : [["↑↓", "navigate"], ["→", "actions"], ["←", "back"], ["⏎", "select"], ["esc", "close"]];

  let lastGroup: string | undefined;
  return (
    <div className="pal" role="listbox" aria-label={mode}>
      <div className="pal-in">
      <div className="pal-head">
        <span className="pal-crumb">{acts ? actsTitle : mode === "workspace" ? dir.split("/").pop() || "workspace" : mode}</span>
        <span className="sp" />
        {mode !== "commands" && <button className="pal-back" onMouseDown={(e) => e.preventDefault()} onClick={() => (acts ? setActs(null) : onPanel("commands"))}><CornerLeftUp size={12} />commands</button>}
      </div>
      <div className="pal-list" ref={listRef}>
        {shown.map((r, i) => {
          const head = r.group && r.group !== lastGroup ? r.group : null;
          lastGroup = r.group || lastGroup;
          const I = r.icon;
          return [
            head && <div key={r.key + ":g"} className="pal-group">{head}</div>,
            <button key={r.key} data-i={i} className={"pal-row" + (i === idx ? " on" : "") + (r.dim ? " dim" : "") + (r.danger ? " danger" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setIdx(i); r.act(); }}
              onMouseEnter={() => setIdx(i)}
              onDoubleClick={() => r.drill?.()}>
              <span className="pal-ic"><I />{r.live && <i className="live-dot" />}</span>
              <span className="pal-label">{r.label}</span>
              {r.hint && <span className="pal-hint">{r.hint}</span>}
              {r.drill && <ChevronRight size={12} className="pal-more" />}
            </button>,
          ];
        })}
        {!shown.length && <div className="pal-empty">{mode === "processes" ? "No background processes" : mode === "sources" ? "No sources yet" : mode === "skills" ? (skills === null ? "Loading skills…" : "No skills installed") : "Nothing matches"}</div>}
      </div>
      <div className="pal-foot">{hints.map(([k, h]) => <span key={k}><kbd>{k}</kbd>{h}</span>)}</div>
      </div>
    </div>
  );
});
