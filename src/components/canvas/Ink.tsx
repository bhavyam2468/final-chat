"use client";
/* Freehand annotation over a page or image.
   Pen strokes render at full opacity with quadratic smoothing and pointer-pressure width;
   the highlighter (hold Shift) renders each colour as one flat pass composited from an offscreen
   canvas, so overlapping strokes never darken into each other — it reads like a real highlighter. */
import { useCallback, useEffect, useRef } from "react";

export type Stroke = { c: string; w: number; p: [number, number][] };

export function Ink({ strokes, onChange, active }: { strokes: Stroke[]; onChange: (s: Stroke[]) => void; active: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Stroke | null>(null);

  const draw = useCallback(() => {
    const c = cv.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    g.lineCap = "round"; g.lineJoin = "round";
    const all = cur.current ? [...strokes, cur.current] : strokes;
    const pen = all.filter((s) => !s.c.startsWith("rgba"));
    const hi = all.filter((s) => s.c.startsWith("rgba"));
    // highlighter: one solid pass per colour, then a single flat composite — overlaps stay even
    const byColor = new Map<string, Stroke[]>();
    for (const s of hi) { const k = s.c + "|" + s.w; (byColor.get(k) || byColor.set(k, []).get(k)!).push(s); }
    for (const [, group] of byColor) {
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const og = off.getContext("2d")!;
      og.setTransform(dpr, 0, 0, dpr, 0, 0);
      og.lineCap = "round"; og.lineJoin = "round";
      for (const s of group) path(og, s, r);
      g.globalAlpha = 0.42;
      g.drawImage(off, 0, 0, r.width, r.height);
      g.globalAlpha = 1;
    }
    for (const s of pen) { g.strokeStyle = s.c; path(g, s, r, true); }
  }, [strokes]);

  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (cv.current) ro.observe(cv.current); return () => ro.disconnect(); }, [draw]);

  const pt = (e: React.PointerEvent): [number, number] => { const r = cv.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const accent = typeof window !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() : "#c07040";
  return <canvas ref={cv} className={"ink" + (active ? " on" : "")} style={{ width: "100%", height: "100%" }}
    onPointerDown={(e) => {
      if (!active) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      cur.current = { c: e.shiftKey ? "rgba(214,170,88,1)" : accent, w: e.shiftKey ? 14 : 2.4, p: [pt(e)] };
    }}
    onPointerMove={(e) => { if (!cur.current) return; cur.current.p.push(pt(e)); draw(); }}
    onPointerUp={() => { if (cur.current && cur.current.p.length > 1) onChange([...strokes, cur.current]); cur.current = null; draw(); }} />;
}

/** Smoothed stroke: quadratic curves through segment midpoints. */
function path(g: CanvasRenderingContext2D, s: Stroke, r: { width: number; height: number }, vary = false) {
  const P = s.p.map(([x, y]) => [x * r.width, y * r.height] as [number, number]);
  if (P.length === 1) { g.fillStyle = s.c; g.beginPath(); g.arc(P[0][0], P[0][1], s.w / 2, 0, Math.PI * 2); g.fill(); return; }
  g.strokeStyle = s.c;
  if (!vary || P.length < 3) {
    g.lineWidth = s.w;
    g.beginPath(); g.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length - 1; i++) { const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2; g.quadraticCurveTo(P[i][0], P[i][1], mx, my); }
    g.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
    g.stroke();
    return;
  }
  // pressure-varied pen: short segments with widths eased from point spacing (fast = thin, slow = thick)
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    g.lineWidth = Math.max(1.1, s.w * (1 - Math.min(0.55, d / 26)));
    g.beginPath(); g.moveTo(P[i - 1][0], P[i - 1][1]); g.lineTo(P[i][0], P[i][1]); g.stroke();
  }
}
