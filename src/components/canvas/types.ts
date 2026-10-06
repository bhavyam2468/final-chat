"use client";
/* Canvas kinds, icons and content measurement. Pure geometry and the window model live in
   ./geometry (re-exported here as the single import site for the canvas layer). */
import { FileText, Image as ImageIcon, Table, Presentation, Package, Globe, CirclePlay, MonitorPlay, AudioLines, AppWindow, MessageSquare, Code2, type LucideIcon } from "lucide-react";
import { fileUrl, type CanvasSpec } from "../ctx";
import { kindOf, kindOfSpec, type Edge, type Win } from "./geometry";

export * from "./geometry";

const ICONS: Record<string, LucideIcon> = {
  pdf: FileText, doc: FileText, md: FileText, text: FileText, image: ImageIcon, sheet: Table, slides: Presentation,
  archive: Package, web: Globe, youtube: CirclePlay, video: MonitorPlay, audio: AudioLines, ui: AppWindow, chat: MessageSquare, html: Code2,
};
export const kindIcon = (spec: CanvasSpec) => ICONS[kindOfSpec(spec)] || AppWindow;

/** Same content already open? (exact spec match keeps focus/restore semantics cheap) */
export const sameSpec = (a: CanvasSpec, b: CanvasSpec) => JSON.stringify(a) === JSON.stringify(b);

/** Per-file sidecar paths: notes and annotations live beside the content, under notes/. */
const baseName = (p: string) => p.split("/").pop() || p;
export const notesPath = (p: string) => `notes/${baseName(p)}`;

/** Old persisted shapes (peek as a Rect, dockPeek) migrate to the new model on load;
    new-shape fields (home, wasDock) pass through untouched. */
export function migrateWin(w: Win & { peek?: unknown; dockPeek?: boolean; prevDockW?: number }): Win {
  const peek = typeof w.peek === "string" && ["l", "r", "t", "b"].includes(w.peek) ? (w.peek as Edge) : null;
  const parked = !peek && (typeof w.peek === "object" || w.dockPeek); // was parked in the old model
  return {
    id: w.id, spec: w.spec, x: parked && w.w ? Math.max(16, innerWidth - w.w - 24) : w.x, y: w.y || 16, w: Math.max(320, w.w || 560), h: Math.max(220, w.h || 420),
    z: w.z || 1, dock: !!w.dock && !w.min, min: !!w.min, peek, pinned: !!w.pinned, home: w.home, wasDock: w.wasDock,
  };
}

/** Natural aspect ratio of the content, so a 16:9 image opens a ~16:9 window that hugs it. */
export function contentRatio(spec: CanvasSpec): Promise<{ ratio: number; pw?: number } | null> {
  return new Promise((res) => {
    const to = setTimeout(() => res(null), 1200);
    const done = (v: { ratio: number; pw?: number } | null) => { clearTimeout(to); res(v); };
    if (spec.kind === "youtube" || spec.kind === "web") return done({ ratio: 16 / 9 });
    if (spec.kind === "ui" || spec.kind === "md" || spec.kind === "chat") return done({ ratio: 16 / 10 });
    if (spec.kind !== "file") return done(null);
    const k = kindOf(spec.path);
    if (k === "video") return done({ ratio: 16 / 9 });
    if (k === "pdf" || k === "doc") return done({ ratio: 1 / 1.35 });
    if (k === "slides") return done({ ratio: 16 / 9 });
    if (k !== "image") return done(null);
    const im = new Image();
    im.onload = () => done(im.naturalWidth && im.naturalHeight ? { ratio: im.naturalWidth / im.naturalHeight, pw: im.naturalWidth } : null);
    im.onerror = () => done(null);
    im.src = fileUrl(spec.path);
  });
}
