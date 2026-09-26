"use client";
/* BlocksUI host. One sandboxed iframe per <ui> block, created the moment the block opens.
   The growing source is streamed into it; the in-frame runtime mounts finished elements once
   (with an enter animation) and shows shape-matched placeholders for the element being written. */
import { memo, useEffect, useRef, useState } from "react";
import { useApp } from "./ctx";
import { youtubeId } from "@/lib/shared";
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
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${o}/blocks/runtime.css"><style>:root{${vars}}</style></head><body class="${fill ? "fill" : ""}" data-theme="${theme}"><div id="root"></div>${tpl}<script>window.name=${JSON.stringify(id)};window.BLOCKS_ORIGIN=${JSON.stringify(o)}</script><script src="${o}/blocks/runtime.js"></script><script src="${o}/blocks/elements.js"></script><script>Blocks.connect()</script></body></html>`;
}

async function toWorkspace(path: string, text: string) {
  const r = await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path, content: text }) });
  return r.ok;
}

export const Block = memo(function Block({ source, done, fill = false }: { source: string; done: boolean; fill?: boolean }) {
  const app = useApp();
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(fill ? 0 : 64);
  const [id] = useState(() => "blk" + Math.random().toString(36).slice(2));
  const [doc] = useState(() => (typeof window === "undefined" ? "" : blocksShell(id, fill)));
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

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.src !== "blocks" || m.frame !== id) return;
      const reply = (value: unknown) => post({ type: "reply", id: m.id, value });
      switch (m.type) {
        case "ready":
          st.current.ready = true;
          post({ type: "theme", vars: themeVars(), theme: document.documentElement.dataset.theme });
          flush(); break;
        case "height": if (!fill) setH(Math.min(2400, Math.max(24, m.h))); break;
        case "lm": app.sendUiEvent(m.data, m.opts); break;
        case "save": { const ok = await toWorkspace(String(m.path), String(m.text)); app.refreshTree(); reply(ok); break; }
        case "py": {
          const r = await fetch("/api/python", { method: "POST", body: JSON.stringify({ code: m.code }) }).then((r) => r.json()).catch((err) => ({ out: String(err) }));
          reply(r.out); app.refreshTree(); break;
        }
        case "upload": {
          const bin = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
          const fd = new FormData(); fd.append("dir", m.dir || "uploads"); fd.append("files", new File([bin], m.name, { type: m.type }));
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
        case "error": console.warn("[blocks]", m.text); break;
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

  const frame = <iframe ref={ref} className={fill ? "blk-frame fill" : "blk-frame"} style={fill ? undefined : { height: h }} sandbox="allow-scripts allow-forms allow-popups allow-modals" srcDoc={doc} title="block" />;
  if (fill) return frame;
  // inline blocks can move to a canvas window (everything renderable inline renders in canvas and vice versa)
  const title = source.match(/<x-(?:section|card)[^>]*\btitle="([^"]+)"/)?.[1] || source.match(/<h[1-3][^>]*>([^<]{1,60})</)?.[1] || "Block";
  return <div className="blk-wrap">{frame}{done && <button className="ib sm blk-pop" aria-label="Open in canvas" onClick={() => app.openCanvas({ kind: "ui", title, source })}><AppWindow /></button>}</div>;
});
