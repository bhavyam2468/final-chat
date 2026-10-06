"use client";
/* The canvas layer: every window, the minimize rail on the left edge, and the shared window api.
   State changes flow App → wins → frames; frames commit gestures back through one small api.
   Windows stay mounted while minimized, so their content (scroll position, iframes, forms)
   survives minimize and restore — only the transform changes. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { PictureInPicture2, PanelRight } from "lucide-react";
import { Win, viewport as vpOf } from "./types";
import { WindowFrame, FrameApi } from "./WindowFrame";
import { MinRail, railIconCenter } from "./MinRail";
import { Viewer } from "./Viewer";

export function CanvasLayer({ wins, setWins, dockW, setDockW }: { wins: Win[]; setWins: React.Dispatch<React.SetStateAction<Win[]>>; dockW: number; setDockW: (w: number) => void }) {
  const [vp, setVp] = useState(vpOf);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = () => { if (t) clearTimeout(t); t = setTimeout(() => setVp(vpOf()), 120); };
    addEventListener("resize", on);
    return () => { removeEventListener("resize", on); if (t) clearTimeout(t); };
  }, []);

  const upd = useCallback((id: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w))), [setWins]);
  const front = useCallback((id: string) => setWins((ws) => {
    const top = Math.max(0, ...ws.map((w) => w.z));
    const me = ws.find((w) => w.id === id);
    if (!me || me.z === top) return ws;
    // keep stacking order, but rebase when z would outgrow the rail's layer
    if (top > 24) {
      const order = [...ws].sort((a, b) => a.z - b.z);
      const base = new Map(order.map((w, i) => [w.id, i + 1]));
      return ws.map((w) => ({ ...w, z: w.id === id ? order.length + 1 : base.get(w.id) || w.z }));
    }
    return ws.map((w) => (w.id === id ? { ...w, z: top + 1 } : w));
  }), [setWins]);

  const api = useMemo<FrameApi>(() => ({
    onCommit: (id, r) => upd(id, { x: r.x, y: r.y, w: r.w, h: r.h }),
    onPin: (id, pinned) => upd(id, { pinned }),
    onFront: front,
    onClose: (id) => setWins((ws) => ws.filter((w) => w.id !== id)),
    onDock: (id, dock, home) => setWins((ws) => {
      const me = ws.find((w) => w.id === id);
      if (!me || me.dock === dock) return ws;
      if (dock) {
        // the sidebar takes one window; the previous occupant parks in the rail
        const h = home || { x: me.x, y: me.y, w: me.w, h: me.h };
        return ws.map((w) => w.id === id
          ? { ...w, dock: true, min: false, peek: null, home: h, wasDock: false }
          : w.dock ? { ...w, dock: false, min: true, home: { x: w.x, y: w.y, w: w.w, h: w.h }, wasDock: true } : w);
      }
      return ws.map((w) => (w.id === id ? { ...w, dock: false } : w));
    }),
    onPeek: (id, edge, home) => upd(id, { peek: edge, dock: false, min: false, home }),
    onRestorePeek: (id) => setWins((ws) => ws.map((w) => (w.id === id && w.home ? { ...w, peek: null, x: w.home.x, y: w.home.y, w: w.home.w, h: w.home.h, home: undefined } : w))),
    onMin: (id, min) => setWins((ws) => {
      if (!min) {
        return ws.map((w) => {
          if (w.id !== id) return w;
          const home = w.home || { x: w.x, y: w.y, w: w.w, h: w.h };
          const redock = w.wasDock && !ws.some((o) => o.dock && o.id !== id) && vpOf().w >= 760;
          return redock ? { ...w, min: false, dock: true, wasDock: false, home: undefined } : { ...w, min: false, dock: false, peek: null, x: home.x, y: home.y, w: home.w, h: home.h, home: undefined, wasDock: false };
        });
      }
      return ws.map((w) => (w.id === id ? { ...w, min: true, peek: null, dock: false, wasDock: w.dock || w.wasDock, home: w.home || { x: w.x, y: w.y, w: w.w, h: w.h } } : w));
    }),
    setDockW,
  }), [upd, front, setWins, setDockW]);

  const minWins = useMemo(() => wins.filter((w) => w.min), [wins]);
  // stable per-id fly targets: identity only changes when the rail composition or viewport does,
  // so minimize/restore animations are never restarted by unrelated renders
  const railIds = minWins.map((w) => w.id).join(",");
  const flyMap = useMemo(() => {
    const ids = railIds ? railIds.split(",") : [];
    const m: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, i) => (m[id] = railIconCenter(i, ids.length, vp)));
    return m;
  }, [railIds, vp]);

  return <>
    <AnimatePresence>
      {wins.map((w) => (
        <WindowFrame key={w.id} win={w} dockW={dockW} vp={vp} flyTo={flyMap[w.id] || null} api={api}>
          <Viewer spec={w.spec} winId={w.id} ctl={!w.min && !w.peek && <>
            <span className="bar-sep" />
            <button className="ib sm" aria-label={w.dock ? "Float" : "Dock beside chat"} title={w.dock ? "Float this window" : "Dock beside chat (or drag it to the right edge)"} onClick={() => api.onDock(w.id, !w.dock)}>{w.dock ? <PictureInPicture2 /> : <PanelRight />}</button>
          </>} />
        </WindowFrame>
      ))}
    </AnimatePresence>
    <MinRail wins={minWins} onRestore={(id) => api.onMin(id, false)} onClose={(id) => api.onClose(id)} />
  </>;
}
