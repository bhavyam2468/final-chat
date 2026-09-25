"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./ctx";

const VARS = ["--bg", "--fg", "--muted", "--line", "--surface", "--accent", "--success", "--danger", "--r"];
function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim()]));
}

export function splitSource(src: string) {
  let rel = "", js = "", py = "";
  const html = src
    .replace(/<style\s+type="rel"\s*>([\s\S]*?)(<\/style>|$)/gi, (_, c) => ((rel += c + "\n"), ""))
    .replace(/<script\s+type="(?:text\/)?python"\s*>([\s\S]*?)(<\/script>|$)/gi, (_, c) => ((py += c + "\n"), ""))
    .replace(/<script(?:\s[^>]*)?>([\s\S]*?)(<\/script>|$)/gi, (_, c) => ((js += c + "\n"), ""))
    .replace(/<style[\s\S]*?(<\/style>|$)/gi, "");
  return { html, rel, js, py };
}

function srcdoc(source: string, fill: boolean, id: string) {
  const o = location.origin;
  const { html, rel, js, py } = splitSource(source);
  const vars = themeVars();
  const theme = document.documentElement.dataset.theme || "dark";
  const esc = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="${o}/blocks/runtime.css"><style>:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}</style></head><body class="${fill ? "fill" : ""}" data-theme="${theme}"><div id="root">${html}</div><script type="text/rel">${esc(rel)}</script>${py ? `<script type="text/python">${esc(py)}</script>` : ""}<script type="text/blocks">${esc(js)}</script><script>window.name=${JSON.stringify(id)}</script><script src="${o}/blocks/runtime.js"></script><script>BlocksBoot()</script></body></html>`;
}

function Skeleton({ source }: { source: string }) {
  const tags = useMemo(() => [...source.matchAll(/<(x-[\w-]+|button|input|select|textarea|h[1-3]|p|label)\b/g)].map((m) => m[1]).slice(0, 14), [source]);
  return (
    <div className="blk-skel" aria-hidden>
      {tags.map((t, i) => <span key={i} data-t={t.startsWith("x-") ? "viz" : t} style={{ animationDelay: `${i * 30}ms` }} />)}
    </div>
  );
}

export const Block = memo(function Block({ source, done, fill = false }: { source: string; done: boolean; fill?: boolean }) {
  const app = useApp();
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const id = useMemo(() => "blk" + Math.random().toString(36).slice(2), []);
  const doc = useMemo(() => (done && typeof window !== "undefined" ? srcdoc(source, fill, id) : ""), [done, source, fill, id]);

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.src !== "blocks" || m.frame !== id) return;
      const reply = (value: unknown) => ref.current?.contentWindow?.postMessage({ type: "reply", id: m.id, value }, "*");
      if (m.type === "height" && !fill) setH(Math.min(1400, Math.max(40, m.h)));
      else if (m.type === "lm") app.sendUiEvent(m.data);
      else if (m.type === "save") { await fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ path: m.path, content: m.text }) }); app.refreshTree(); reply(true); }
      else if (m.type === "py") { const r = await fetch("/api/python", { method: "POST", body: JSON.stringify({ code: m.code }) }).then((r) => r.json()); reply(r.out); app.refreshTree(); }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [id, fill, app]);

  useEffect(() => {
    const obs = new MutationObserver(() => ref.current?.contentWindow?.postMessage({ type: "theme", vars: themeVars(), theme: document.documentElement.dataset.theme }, "*"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  if (!done) return <Skeleton source={source} />;
  return <iframe ref={ref} className={fill ? "blk-frame fill" : "blk-frame"} style={fill ? undefined : { height: h }} sandbox="allow-scripts allow-forms allow-popups" srcDoc={doc} title="block" />;
});
