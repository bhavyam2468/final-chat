"use client";
/* Pure canvas geometry and window model — zero runtime imports, unit-testable in node.
   A window is one fixed-position surface in exactly one placement: docked (sidebar beside
   chat), floating, parked at a screen edge (peek), or minimized into the edge rail.
   Floating geometry (x/y/w/h) is always kept so every parking/minimizing is reversible. */
import type { CanvasSpec } from "../ctx";

export type Rect = { x: number; y: number; w: number; h: number };
/** Screen edge a window can park against. The right edge is the dock's home on desktop. */
export type Edge = "l" | "r" | "t" | "b";
export type Zone = Edge | "tl" | "tr" | "bl" | "br"; // resize directions

export type Win = {
  id: string;
  spec: CanvasSpec;
  /** floating geometry — also the restore target while docked / parked / minimized */
  x: number; y: number; w: number; h: number;
  z: number;
  dock: boolean;          // sidebar slot beside the chat
  min: boolean;           // parked as an icon in the edge rail
  peek?: Edge | null;     // parked at a screen edge, peeking
  pinned: boolean;        // bars are part of the layout (not floating over content)
  /** geometry captured when the window left the floating state, so it can return exactly */
  home?: Rect;
  /** a docked window that was minimized returns to the dock when restored, if it is still free */
  wasDock?: boolean;
};

const KINDS: [RegExp, string][] = [
  [/^(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/, "image"], [/^pdf$/, "pdf"], [/^html?$/, "html"], [/^ui$/, "ui"], [/^(md|markdown|mdx)$/, "md"],
  [/^(xlsx|xlsm|xls|ods|csv|tsv)$/, "sheet"], [/^(docx|doc|odt|rtf)$/, "doc"], [/^(pptx|ppt|odp|key)$/, "slides"],
  [/^(zip|jar|tar|tgz|tar\.gz|tar\.bz2|tar\.xz|whl|epub)$/, "archive"], [/^(mp4|webm|mov|mkv|m4v|ogv)$/, "video"], [/^(mp3|wav|ogg|m4a|flac|aac|opus)$/, "audio"],
  [/^(exe|bin|dmg|iso|so|dll|o|class|pyc|woff2?|ttf|otf|sqlite|db|gz|7z|rar|bz2|xz)$/, "binary"],
];
export const extOf = (p: string) => (p.match(/\.(tar\.gz|tar\.bz2|tar\.xz|[^./]+)$/i)?.[1] || "").toLowerCase();
export const kindOf = (p: string) => KINDS.find(([re]) => re.test(extOf(p)))?.[1] || "text";
export const kindOfSpec = (spec: CanvasSpec) => (spec.kind === "file" ? kindOf(spec.path) : spec.kind);


/* ---------------- geometry helpers (pure; unit-tested) ---------------- */

export const PEEK = 44;           // visible sliver of a parked window
export const DOCK_PAD = 8;        // docked panel inset from the viewport
export const MIN_W = 340, MIN_H = 220;

export type Vp = { w: number; h: number };
export const viewport = (): Vp => ({ w: typeof window === "undefined" ? 1280 : innerWidth, h: typeof window === "undefined" ? 800 : innerHeight });

/** Docked sidebar geometry for a given dock width. */
export const dockRect = (dockW: number, vp: Vp): Rect => ({ x: Math.max(DOCK_PAD, vp.w - dockW - DOCK_PAD), y: DOCK_PAD, w: Math.min(dockW, vp.w - 2 * DOCK_PAD), h: vp.h - 2 * DOCK_PAD });

/** Where a window parks at an edge: fully offscreen except the peek tab, size unchanged. */
export function peekRect(edge: Edge, home: Rect, vp: Vp): Rect {
  const h = Math.min(home.h, vp.h - 2 * DOCK_PAD);
  const y = Math.min(Math.max(home.y, DOCK_PAD), Math.max(DOCK_PAD, vp.h - h - DOCK_PAD));
  const w = Math.min(home.w, vp.w - 2 * DOCK_PAD);
  const x = Math.min(Math.max(home.x, DOCK_PAD), Math.max(DOCK_PAD, vp.w - w - DOCK_PAD));
  if (edge === "l") return { x: PEEK - home.w, y, w: home.w, h: home.h };
  if (edge === "r") return { x: vp.w - PEEK, y, w: home.w, h: home.h };
  if (edge === "t") return { x, y: PEEK - home.h, w: home.w, h: home.h };
  return { x, y: vp.h - PEEK, w: home.w, h: home.h };
}

/** Hover-peek: slide out far enough to read — the exposed part (tab included) never exceeds
    62% of the screen, and a small window simply shows all of itself. */
export function peekOutRect(edge: Edge, home: Rect, vp: Vp): Rect {
  const p = peekRect(edge, home, vp);
  const outX = Math.min(home.w - PEEK, Math.max(0, Math.round(vp.w * 0.62) - PEEK));
  const outY = Math.min(home.h - PEEK, Math.max(0, Math.round(vp.h * 0.62) - PEEK));
  if (edge === "l") return { ...p, x: p.x + outX };
  if (edge === "r") return { ...p, x: p.x - outX };
  if (edge === "t") return { ...p, y: p.y + outY };
  return { ...p, y: p.y - outY };
}

/** Which resize zone does the pointer sit in, relative to a window rect? null = interior/far away.
    A band `inner` px inside the edge and `outer` px outside it is live; corners win within `corner` px. */
export function zoneFor(rect: Rect, px: number, py: number, inner = 20, outer = 16, corner = 26): Zone | null {
  const near = (v: number, lo: number, hi: number, band: number) => v >= lo - band && v <= hi + band;
  if (!near(px, rect.x, rect.x + rect.w, outer) || !near(py, rect.y, rect.y + rect.h, outer)) return null;
  const el = px - rect.x, er = rect.x + rect.w - px, et = py - rect.y, eb = rect.y + rect.h - py;
  const cornerL = el < corner, cornerR = er < corner, cornerT = et < corner, cornerB = eb < corner;
  if (cornerT && cornerL) return "tl";
  if (cornerT && cornerR) return "tr";
  if (cornerB && cornerL) return "bl";
  if (cornerB && cornerR) return "br";
  const band = inner + outer;
  if (et < band) return "t";
  if (eb < band) return "b";
  if (el < band) return "l";
  if (er < band) return "r";
  return null;
}

/** Apply a resize zone drag to a rect. Returns the new rect (clamped to mins). */
export function applyZone(o: Rect, z: Zone, dx: number, dy: number, vp: Vp, minW = MIN_W, minH = MIN_H): Rect {
  let { x, y, w, h } = o;
  if (z.includes("l")) { const nx = Math.min(o.x + dx, o.x + o.w - minW); w = o.w - (nx - o.x); x = nx; }
  if (z.includes("r")) w = Math.max(minW, o.w + dx);
  if (z.includes("t")) { const ny = Math.min(o.y + dy, o.y + o.h - minH); h = o.h - (ny - o.y); y = ny; }
  if (z.includes("b")) h = Math.max(minH, o.h + dy);
  if (y < 0) { h += y; y = 0; } // the top edge never leaves the screen
  return { x: Math.round(x), y: Math.round(y), w: Math.min(Math.round(w), vp.w - 8), h: Math.min(Math.round(h), vp.h - 8) };
}

/** Edges that park a window. The right edge is the dock's home on desktop; on narrow screens it parks too. */
export const peekEdges = (vp: Vp): Edge[] => (vp.w < 760 ? ["l", "r", "t", "b"] : ["l", "t", "b"]);

/** Edge whose snap zone the pointer is in while dragging (null = none). */
export function snapEdge(px: number, py: number, vp: Vp, dist = 26): Edge | null {
  const edges = peekEdges(vp);
  if (edges.includes("l") && px < dist) return "l";
  if (edges.includes("r") && px > vp.w - dist) return "r";
  if (edges.includes("t") && py < dist) return "t";
  if (edges.includes("b") && py > vp.h - dist) return "b";
  return null;
}

/** Is the pointer in the dock drop zone (right side of the screen, desktop only)? */
export const inDockZone = (px: number, vp: Vp) => vp.w >= 760 && px > vp.w - 110;

/** Clamp a floating rect into the viewport after gestures/window resizes. */
export function clampRect(r: Rect, vp: Vp): Rect {
  return { x: Math.min(Math.max(r.x, 16 - r.w), vp.w - 80), y: Math.min(Math.max(r.y, 0), Math.max(0, vp.h - 60)), w: r.w, h: r.h };
}

/** Cascade origin for a new floating window. */
export function cascadeRect(ratio: number | null, pw: number | undefined, floating: number, vp: Vp): Rect {
  let w = Math.min(640, Math.round(vp.w * 0.46)), h = Math.round(vp.h * 0.72);
  let x = vp.w - w - 24 - floating * 28, y = 56 + floating * 28;
  if (ratio) {
    const maxW = Math.min(vp.w - 48, 1280), maxH = vp.h - 64, pad = 24;
    w = Math.round(Math.max(MIN_W, Math.min(maxW, pw ? pw + pad : maxW * 0.66)));
    h = Math.round(w / ratio);
    if (h > maxH) { h = maxH; w = Math.round(h * ratio); }
    x = Math.round((vp.w - w) / 2); y = Math.max(20, Math.round((vp.h - h) / 2));
  }
  return clampRect({ x, y, w: Math.max(w, MIN_W), h: Math.max(h, MIN_H) }, vp);
}

