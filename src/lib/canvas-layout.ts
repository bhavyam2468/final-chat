/** Geometry and presentation policy for the canvas window manager. Kept pure so pointer
 * interactions can be reasoned about and tested without a browser or React. */
export type CanvasRect = { x: number; y: number; w: number; h: number };
export type Viewport = { width: number; height: number };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type PeekSide = "left" | "right" | "top" | "bottom";

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** A canvas gets the sidebar slot when it is free. A second request never evicts the current canvas. */
export function shouldDockCanvas(explicit: boolean | undefined, occupied: boolean) {
  return explicit !== false && !occupied;
}

/** Keep a moved window reachable without preventing it from snapping to a screen edge. */
export function moveCanvasRect(origin: CanvasRect, dx: number, dy: number, viewport: Viewport): CanvasRect {
  return {
    ...origin,
    x: clamp(origin.x + dx, 48 - origin.w, viewport.width - 48),
    y: clamp(origin.y + dy, 0, viewport.height - 48),
  };
}

/** Resize from any edge/corner while keeping the opposite edge anchored and inside the viewport. */
export function resizeCanvasRect(
  origin: CanvasRect,
  dx: number,
  dy: number,
  edge: ResizeEdge,
  viewport: Viewport,
  minWidth = 280,
  minHeight = 180,
): CanvasRect {
  const west = edge.includes("w"), east = edge.includes("e");
  const north = edge.includes("n"), south = edge.includes("s");
  const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height);
  let x: number, y: number, w: number, h: number;

  if (west) {
    const right = clamp(origin.x + origin.w, 0, width);
    const maxW = right;
    w = clamp(right - (origin.x + dx), Math.min(minWidth, maxW), maxW);
    x = right - w;
  } else {
    x = clamp(origin.x, 0, width);
    const maxW = width - x;
    const desiredW = east ? origin.w + dx : origin.w;
    w = clamp(desiredW, Math.min(minWidth, maxW), maxW);
  }

  if (north) {
    const bottom = clamp(origin.y + origin.h, 0, height);
    const maxH = bottom;
    h = clamp(bottom - (origin.y + dy), Math.min(minHeight, maxH), maxH);
    y = bottom - h;
  } else {
    y = clamp(origin.y, 0, height);
    const maxH = height - y;
    const desiredH = south ? origin.h + dy : origin.h;
    h = clamp(desiredH, Math.min(minHeight, maxH), maxH);
  }
  return { x, y, w, h };
}

/** Select the nearest edge only when the pointer is deliberately close to it. */
export function edgeAt(x: number, y: number, viewport: Viewport, threshold = 26): PeekSide | null {
  const distances: [PeekSide, number][] = [
    ["left", x], ["right", viewport.width - x], ["top", y], ["bottom", viewport.height - y],
  ];
  const candidates = distances.filter(([, distance]) => distance >= 0 && distance <= threshold);
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0]?.[0] || null;
}

/** The parked tab is intentionally small and neutral; its origin is stored separately for restore. */
export function peekCanvasRect(origin: CanvasRect, side: PeekSide, viewport: Viewport): CanvasRect {
  const tab = 18;
  if (side === "left" || side === "right") {
    const h = clamp(Math.min(origin.h, 176), 112, Math.max(112, viewport.height - 32));
    const y = clamp(origin.y + (origin.h - h) / 2, 16, Math.max(16, viewport.height - h - 16));
    return { x: side === "left" ? 0 : Math.max(0, viewport.width - tab), y, w: tab, h };
  }
  const w = clamp(Math.min(origin.w, 240), 148, Math.max(148, viewport.width - 32));
  const x = clamp(origin.x + (origin.w - w) / 2, 16, Math.max(16, viewport.width - w - 16));
  return { x, y: side === "top" ? 0 : Math.max(0, viewport.height - tab), w, h: tab };
}

export function dockCanvasRect(viewport: Viewport, width: number, inset = 8): CanvasRect {
  const w = clamp(width, 300, Math.max(300, viewport.width - 300));
  return { x: Math.max(inset, viewport.width - w - inset), y: inset, w, h: Math.max(180, viewport.height - inset * 2) };
}
