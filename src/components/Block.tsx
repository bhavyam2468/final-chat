"use client";
/* BlocksUI host. One sandboxed iframe per <ui> block, created the moment the block opens.
   The growing source is streamed into it; the in-frame runtime mounts finished elements once
   (with an enter animation) and shows shape-matched placeholders for the element being written. */
import { memo, useEffect, useRef, useState } from "react";
import { useApp } from "./ctx";
import { youtubeId } from "@/lib/shared";
import { readNDJSON } from "@/lib/blocks/ndjson";
import { AppWindow } from "lucide-react";

const VARS = ["--bg", "--fg", "--muted", "--faint", "--line", "--surface", "--bubble", "--float", "--accent", "--success", "--danger", "--r"];
export function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim()]));
}

/** Frame document: static shell. Content arrives via postMessage, so the frame never reloads while streaming. */
export function blocksShell(id: string, fill: boolean, inline?: string) {
  const o = location.origin;
  const theme = document.documentElement.dataset.theme || "dark";
  const vars = Object.entries(themeVars()).map(([k, v]) => `${k}:${v}`).join(";");
  const tpl = inline !== undefined ? `<template data-blocks>${inline.replace(/<\/template/gi, "<\\/template")}</template>` : "";
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${o}/blocks/runtime.css"><style>:root{${vars}}</style></head><body class="${fill ? "fill" : ""}" data-theme="${theme}"><div id="root"></div>${tpl}<script>window.name=${JSON.stringify(id)};window.BLOCKS_ORIGIN=${JSON.stringify(o)}</script><script src="${o}/blocks/flow-core.js"></script><script src="${o}/blocks/schema.js"></script><script src="${o}/blocks/runtime.js"></script><script src="${o}/blocks/elements.js"></script><script src="${o}/blocks/flowchart.js"></script><script>Blocks.connect()</script></body></html>`;
}

async function toWorkspace(path: string, text: string) {
  const r = await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path, content: text }) });
  return r.ok;
}

export const Block = memo(function Block({ source, done, fill = false }: { source: string; done: boolean; fill?: boolean }) {
  const app = useApp();
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(fill ? 0 : 64);
  const [issues, setIssues] = useState<string[]>([]);
  const [id] = useState(() => "blk" + Math.random().toString(36).slice(2));
  const [doc] = useState(() => (typeof window === "undefined" ? "" : blocksShell(id, fill)));
  const jobs = useRef(new Map<number, AbortController>());
  const st = useRef({ ready: false, sent: "", sentDone: false, timer: 0 as unknown as ReturnType<typeof setTimeout> | 0, source, done });
  st.current.source = source; st.current.done = done;

  const post = (m: unknown) => ref.current?.contentWindow?.postMessage(m, "*");
  const flush = () => {
    const s = st.current;
    s.timer = 0;
    if (!s.ready || s.sentDone || (s.sent === s.source && !s.done)) return;
    s.sent = s.source; s.sentDone = s.done;
    post({ type: "source", source: s.source, done: s.done });
  };

  // stream source into the frame (throttled; completion is sent immediately)
  useEffect(() => {
    const s = st.current;
    if (!s.ready) return;
    if (done) { if (s.timer) clearTimeout(s.timer); flush(); }
    else if (!s.timer) s.timer = setTimeout(flush, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, done]);

  useEffect(() => () => {
    if (st.current.timer) clearTimeout(st.current.timer);
    for (const controller of jobs.current.values()) controller.abort();
    jobs.current.clear();
  }, []);

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const m = e.data;
      if (e.source !== ref.current?.contentWindow || !m || m.src !== "blocks" || m.frame !== id) return;
      const reply = (value: unknown) => post({ type: "reply", id: m.id, value });
      switch (m.type) {
        case "ready":
          st.current.ready = true;
          post({ type: "theme", vars: themeVars(), theme: document.documentElement.dataset.theme });
          flush(); break;
        case "height": if (!fill && Number.isFinite(m.h)) setH(Math.min(2400, Math.max(24, m.h))); break;
        case "cancel": jobs.current.get(m.id)?.abort(); break;
        case "lm": app.sendUiEvent(m.data, m.opts); break;
        case "save": { const ok = await toWorkspace(String(m.path), String(m.text)); app.refreshTree(); reply(ok); break; }
        case "py": {
          const r = await fetch("/api/python", { method: "POST", body: JSON.stringify({ code: m.code }) }).then((r) => r.json()).catch((err) => ({ out: String(err) }));
          reply(r.out); app.refreshTree(); break;
        }
        case "backend": {
          // One streaming bridge for Python, sandbox Bash, long-running process output, and resource
          // snapshots. The iframe stays responsive while the host forwards NDJSON chunks as they arrive.
          if (!Number.isSafeInteger(m.id) || jobs.current.has(m.id)) break;
          const controller = new AbortController();
          jobs.current.set(m.id, controller);
          const timeout = setTimeout(() => controller.abort(), 305_000);
          try {
            const r = await fetch("/api/blocks", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backend: m.backend, code: m.code, command: m.command, name: m.name, follow: m.follow, cwd: m.cwd, timeout: m.timeout }) });
            if (!r.ok) { reply({ ok: false, code: r.status, out: await r.text() }); break; }
            if (!r.body) throw new Error("Backend response has no stream");
            let data: unknown;
            let result: unknown = { ok: false, code: 1, out: "Backend ended without a result" };
            await readNDJSON(r.body, (event) => {
              if (event.t === "chunk") post({ type: "backend-chunk", id: m.id, chunk: String(event.chunk || "") });
              else if (event.t === "data") { data = event.data; post({ type: "backend-data", id: m.id, data }); }
              else if (event.t === "done") result = { ok: !!event.ok, code: Number(event.code ?? 1), out: String(event.out || ""), ...(data === undefined ? {} : { data }) };
            });
            reply(result); app.refreshTree();
          } catch (err) { reply({ ok: false, code: 1, out: controller.signal.aborted ? "Backend request cancelled" : String(err) }); }
          finally { clearTimeout(timeout); jobs.current.delete(m.id); }
          break;
        }
        case "upload": {
          const bin = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
          const fd = new FormData(); fd.append("dir", m.dir || "uploads"); fd.append("files", new File([bin], m.name, { type: String(m.mime || "application/octet-stream") }));
          const out = await fetch("/api/workspace/upload", { method: "POST", body: fd }).then((r) => r.json()).catch(() => []);
          app.refreshTree(); reply(out[0] || null); break;
        }
        case "open": {
          const t = String(m.target || "");
          const yt = youtubeId(t);
          if (yt) app.openCanvas({ kind: "youtube", title: "Video", id: yt });
          else if (/^https?:/.test(t)) app.openCanvas({ kind: "web", title: t.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], url: t });
          else app.openFile(t);
          break;
        }
        case "issues": setIssues(m.issues || []); break;
        case "error": if (st.current.done) setIssues((x) => (x.includes("error: " + m.text) || x.length > 11 ? x : [...x, "error: " + m.text])); break;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fill, app]);

  useEffect(() => {
    const obs = new MutationObserver(() => post({ type: "theme", vars: themeVars(), theme: document.documentElement.dataset.theme }));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => obs.disconnect();
  }, []);

  // the in-frame self-check found something a person would see as broken: offer the model a precise fix request
  const fix = issues.length > 0 && done && (
    <div className="blk-issues" role="status">
      <span>{issues.length === 1 ? "1 problem in this block" : `${issues.length} problems in this block`}</span>
      <button className="blk-fix" onClick={() => { app.sendText(`The block you rendered has problems:\n${issues.map((i) => "- " + i).join("\n")}\nFix them and re-render the block.`); setIssues([]); }}>Fix</button>
      <button className="ib sm" aria-label="Dismiss" onClick={() => setIssues([])}>×</button>
    </div>
  );
  const frame = <iframe ref={ref} className={fill ? "blk-frame fill" : "blk-frame"} style={fill ? undefined : { height: h }} sandbox="allow-scripts allow-forms allow-popups allow-modals" srcDoc={doc} title="block" />;
  if (fill) return <>{frame}{fix}</>;
  // inline blocks can move to a canvas window (everything renderable inline renders in canvas and vice versa)
  const title = source.match(/<x-(?:section|card)[^>]*\btitle="([^"]+)"/)?.[1] || source.match(/<h[1-3][^>]*>([^<]{1,60})</)?.[1] || "Block";
  return <div className="blk-wrap">{frame}{fix}{done && <button className="ib sm blk-pop" aria-label="Open a copy in canvas" title="Open a new instance in canvas" onClick={() => app.openCanvas({ kind: "ui", title, source })}><AppWindow /></button>}</div>;
});
