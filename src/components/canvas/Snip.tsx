"use client";
/* Drag a rectangle over the rendered content; the region is composited from the visible
   canvases/images/video frames and handed back as a PNG (pasted into the input bar). */
import { useRef, useState } from "react";
import { Rect } from "./types";

export function SnipLayer({ winId, onDone }: { winId: string; onDone: (b: Blob) => void }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const finish = (r: Rect) => {
    const body = document.querySelector(`[data-win="${winId}"] .win-body`);
    if (!body || r.w < 8 || r.h < 8) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const out = document.createElement("canvas");
    out.width = Math.round(r.w * dpr); out.height = Math.round(r.h * dpr);
    const g = out.getContext("2d")!; g.scale(dpr, dpr);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#fff";
    g.fillRect(0, 0, r.w, r.h);
    for (const el of [...body.querySelectorAll("canvas, img, video")] as (HTMLCanvasElement | HTMLImageElement | HTMLVideoElement)[]) {
      const er = el.getBoundingClientRect();
      const L = Math.max(r.x, er.left), T = Math.max(r.y, er.top);
      const R = Math.min(r.x + r.w, er.right), B = Math.min(r.y + r.h, er.bottom);
      const iw = R - L, ih = B - T; if (iw <= 0 || ih <= 0) continue;
      const sw = el instanceof HTMLCanvasElement ? el.width : el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
      const sh = el instanceof HTMLCanvasElement ? el.height : el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
      if (!sw || !sh) continue;
      try { g.drawImage(el, ((L - er.left) / er.width) * sw, ((T - er.top) / er.height) * sh, (iw / er.width) * sw, (ih / er.height) * sh, L - r.x, T - r.y, iw, ih); } catch { /* tainted or undecoded */ }
    }
    out.toBlob((b) => b && onDone(b), "image/png");
  };
  return <div className="snip" role="application" aria-label="Snip region"
    onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY }; setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 }); }}
    onPointerMove={(e) => { if (!start.current) return; const s = start.current; setRect({ x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), w: Math.abs(e.clientX - s.x), h: Math.abs(e.clientY - s.y) }); }}
    onPointerUp={() => { if (start.current && rect) finish(rect); start.current = null; setRect(null); }}>
    {rect && rect.w > 2 && <div className="snip-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
    <span className="snip-hint">drag to snip · esc to cancel</span>
  </div>;
}
