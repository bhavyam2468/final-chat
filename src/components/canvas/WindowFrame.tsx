"use client";
/* One canvas window. The content IS the window: bars float over it, handles appear only when the
   cursor nears an edge (a thin pill outside the edge that follows the cursor — pull it to resize),
   and placement is a first-class state: floating, docked beside chat, parked at a screen edge
   (peek), or minimized into the rail. Geometry is driven by MotionValues so dragging and resizing
   run at pointer speed with zero React re-renders; springs carry every state change.
   Handles/previews live in a sibling overlay (fixed, never clipped by the window). */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useSpring, useTransform, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { Pin, PinOff, Minus, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { applyZone, clampRect, dockRect, Edge, kindIcon, peekOutRect, peekRect, Rect, snapEdge, inDockZone, Win, zoneFor, Zone, DOCK_PAD } from "./types";

export const SPRING = {
  pos: { type: "spring" as const, stiffness: 480, damping: 38 },
  size: { type: "spring" as const, stiffness: 520, damping: 44 },
  ui: { type: "spring" as const, stiffness: 520, damping: 40 },
  follow: { stiffness: 750, damping: 48 },
};
const CURSORS: Record<Zone, string> = { l: "ew-resize", r: "ew-resize", t: "ns-resize", b: "ns-resize", tl: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", br: "nwse-resize" };
const dockZones = new Set<Zone>(["l", "tl", "bl"]); // the docked panel's inner edge (right side of the screen)

type Gesture =
  | { kind: "move"; sx: number; sy: number; orig: Rect; undocking: boolean }
  | { kind: "resize"; zone: Zone; sx: number; sy: number; orig: Rect }
  | { kind: "ghost"; zone: Zone; sx: number; origW: number };

export type FrameApi = {
  onCommit: (id: string, r: Rect) => void;
  onDock: (id: string, dock: boolean, home?: Rect) => void;
  onPeek: (id: string, edge: Edge, home: Rect) => void;
  onRestorePeek: (id: string) => void;
  onMin: (id: string, min: boolean) => void;
  onPin: (id: string, pinned: boolean) => void;
  onClose: (id: string) => void;
  onFront: (id: string) => void;
  setDockW: (w: number) => void;
};

export const WindowFrame = memo(function WindowFrame({ win, dockW, vp, flyTo, api, children }: {
  win: Win; dockW: number; vp: { w: number; h: number }; flyTo?: { x: number; y: number } | null; api: FrameApi; children?: React.ReactNode;
}) {
  const mx = useMotionValue(win.x), my = useMotionValue(win.y), mw = useMotionValue(win.w), mh = useMotionValue(win.h);
  const hx = useSpring(0, SPRING.follow), hy = useSpring(0, SPRING.follow); // handle follows the cursor along the edge
  const ghostW = useMotionValue(0);
  const ghostRight = useTransform(ghostW, (v) => v + 22);
  const ghostLabel = useTransform(ghostW, (v) => `${Math.round(v)} px`);
  const [zone, setZone] = useState<Zone | null>(null);
  const [lift, setLift] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [snap, setSnap] = useState<{ edge: Edge | null; dock: boolean }>({ edge: null, dock: false });
  const [out, setOut] = useState(false); // parked: slid out on hover
  const [show, setShow] = useState<{ t: boolean; b: boolean }>({ t: false, b: false });
  const gest = useRef<Gesture | null>(null);
  const zoneRef = useRef<Zone | null>(null);
  const snapRef = useRef(snap);
  const outRef = useRef(false);
  const hoverTween = useRef<AnimationPlaybackControls[] | null>(null);
  const revealT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoneHide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kind = { Icon: kindIcon(win.spec) }; // member access keeps the icon reference stable for the linter

  const rect = useCallback((): Rect => ({ x: mx.get(), y: my.get(), w: mw.get(), h: mh.get() }), [mx, my, mw, mh]);
  const homeOf = useCallback(() => win.home || { x: win.x, y: win.y, w: win.w, h: win.h }, [win]);

  /* placement changes (dock, park, restore, minimize, viewport resize) animate through springs;
     during a gesture the pointer is the only writer of the motion values */
  useEffect(() => {
    if (gest.current) return;
    if (win.min) {
      const c = flyTo || { x: 28, y: vp.h / 2 };
      const ctrl = [animate(mx, c.x - win.w / 2, SPRING.pos), animate(my, c.y - win.h / 2, SPRING.pos)];
      return () => ctrl.forEach((a) => a.stop());
    }
    if (win.peek && hoverTween.current) return; // the hover tween owns x/y while parked
    const t = win.dock ? dockRect(dockW, vp) : win.peek ? peekRect(win.peek, homeOf(), vp) : { x: win.x, y: win.y, w: win.w, h: win.h };
    const ctrl = [animate(mx, t.x, SPRING.pos), animate(my, t.y, SPRING.pos), animate(mw, t.w, SPRING.size), animate(mh, t.h, SPRING.size)];
    return () => ctrl.forEach((a) => a.stop());
  }, [win.x, win.y, win.w, win.h, win.dock, win.peek, win.min, win.home, flyTo, vp, dockW, homeOf, mx, my, mw, mh]);

  const front = useCallback(() => api.onFront(win.id), [api, win.id]);

  /* ---- proximity handles: a pill outside the nearest edge, following the cursor ---- */
  useEffect(() => {
    if (win.min || win.peek) return;
    const onMove = (e: PointerEvent) => {
      if (zoneHide.current) { clearTimeout(zoneHide.current); zoneHide.current = null; }
      const g = gest.current;
      if (g?.kind === "move") return;
      let z: Zone | null;
      if (g?.kind === "resize" || g?.kind === "ghost") z = g.zone;                       // a gesture owns its zone
      else z = zoneFor(rect(), e.clientX, e.clientY);                                     // else: proximity
      if (win.dock && z && !dockZones.has(z)) z = null;                                   // docked resizes its inner edge only
      if (z !== zoneRef.current) {
        zoneRef.current = z;
        hx.jump(e.clientX); hy.jump(e.clientY); // appear under the cursor, never fly in from afar
        setZone(z);
      }
      if (z) { hx.set(e.clientX); hy.set(e.clientY); }
      // over an iframe the parent gets no moves: let the handle rest after a beat of silence
      zoneHide.current = setTimeout(() => { zoneRef.current = null; setZone(null); }, 500);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => { document.removeEventListener("pointermove", onMove); if (zoneHide.current) clearTimeout(zoneHide.current); };
  }, [win.min, win.peek, win.dock, rect, hx, hy]);

  /* ---- bars floating over content: hover the top/bottom edge; pinning makes them layout ---- */
  const reveal = useCallback((part: "t" | "b" | null) => {
    if (revealT.current) { clearTimeout(revealT.current); revealT.current = null; }
    setShow((s) => {
      const n = part ? { ...s, [part]: true } : { t: false, b: false };
      return n.t === s.t && n.b === s.b ? s : n;
    });
    if (part) revealT.current = setTimeout(() => setShow({ t: false, b: false }), 1000);
  }, []);

  const stopHoverTween = () => { hoverTween.current?.forEach((a) => a.stop()); hoverTween.current = null; };
  const glide = (t: Rect, dur: number) => {
    stopHoverTween();
    const ease = [0.2, 0.7, 0.2, 1] as const;
    const ctrl = [animate(mx, t.x, { duration: dur, ease }), animate(my, t.y, { duration: dur, ease }), animate(mw, t.w, { duration: dur, ease }), animate(mh, t.h, { duration: dur, ease })];
    hoverTween.current = ctrl;
    ctrl[1].then(() => { if (hoverTween.current === ctrl) hoverTween.current = null; }).catch(() => {});
  };

  /* ---- gestures. Pointer capture keeps moves flowing even over iframes. ---- */
  const gestureBegin = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
    front();
  };

  const startResize = (e: React.PointerEvent, z: Zone) => {
    e.preventDefault();
    e.stopPropagation();
    if (win.dock) {
      gest.current = { kind: "ghost", zone: z, sx: e.clientX, origW: dockW };
      setGhost(true); ghostW.jump(dockW);
    } else {
      gest.current = { kind: "resize", zone: z, sx: e.clientX, sy: e.clientY, orig: rect() };
    }
    gestureBegin(e);
  };

  const onWinPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, .win-bar, .peek-tab")) return;
    if (win.min || win.peek) return;
    if (zoneRef.current) return startResize(e, zoneRef.current); // the whole edge band resizes
    front();
  };

  const onBarPointerDown = (e: React.PointerEvent) => {
    if (win.min || win.peek || (e.target as HTMLElement).closest("button, a")) return;
    if (zoneRef.current) return startResize(e, zoneRef.current); // resize wins at the very edge
    e.preventDefault();
    gest.current = { kind: "move", sx: e.clientX, sy: e.clientY, orig: rect(), undocking: win.dock };
    setLift(true);
    gestureBegin(e);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const g = gest.current;
    if (!g) return;
    if (g.kind === "move") {
      let { sx, sy, orig } = g;
      if (g.undocking) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 7) return;
        g.undocking = false; g.orig = rect(); orig = g.orig; // lift the panel out of the dock at its current shape
        api.onDock(win.id, false);
        sx = g.sx = e.clientX; sy = g.sy = e.clientY;
      }
      const r = clampRect({ ...orig, x: orig.x + (e.clientX - sx), y: Math.max(0, orig.y + (e.clientY - sy)) }, vp);
      mx.set(r.x); my.set(r.y);
      const dock = !win.dock && inDockZone(e.clientX, vp);
      const s = { edge: dock ? null : snapEdge(e.clientX, e.clientY, vp), dock };
      if (s.edge !== snapRef.current.edge || s.dock !== snapRef.current.dock) { snapRef.current = s; setSnap(s); }
    } else if (g.kind === "resize") {
      const r = applyZone(g.orig, g.zone, e.clientX - g.sx, e.clientY - g.sy, vp);
      mx.set(r.x); my.set(r.y); mw.set(r.w); mh.set(r.h);
    } else if (g.kind === "ghost") {
      ghostW.set(Math.round(Math.min(Math.max(g.origW - (e.clientX - g.sx), 320), Math.min(760, vp.w - 420))));
    }
  };

  const endGesture = () => {
    const g = gest.current;
    gest.current = null;
    document.body.classList.remove("dragging");
    if (!g) return;
    if (g.kind === "ghost") { setGhost(false); api.setDockW(Math.round(ghostW.get())); return; }
    zoneRef.current = null; setZone(null);
    if (g.kind === "resize") { api.onCommit(win.id, rect()); return; }
    setLift(false);
    const s = snapRef.current;
    snapRef.current = { edge: null, dock: false }; setSnap({ edge: null, dock: false });
    if (s.dock) api.onDock(win.id, true, g.orig);
    else if (s.edge) api.onPeek(win.id, s.edge, g.orig);
    else api.onCommit(win.id, rect());
  };

  /* ---- parked at an edge: hover slides it out fast to peek; click (or leaving) returns it ---- */
  const onPeekEnter = () => {
    if (!win.peek || gest.current || outRef.current) return;
    outRef.current = true; setOut(true);
    glide(peekOutRect(win.peek, homeOf(), vp), 0.26);
    front();
  };
  const onPeekBack = () => {
    if (!win.peek || !outRef.current) return;
    outRef.current = false; setOut(false);
    glide(peekRect(win.peek, homeOf(), vp), 0.3);
  };
  const restorePeek = (e: React.MouseEvent) => {
    e.stopPropagation();
    outRef.current = false; setOut(false);
    stopHoverTween();
    api.onRestorePeek(win.id);
  };

  useEffect(() => () => { stopHoverTween(); if (revealT.current) clearTimeout(revealT.current); }, []);

  const cursor = zone && !win.min && !win.peek ? CURSORS[zone] : undefined;
  const edge = win.peek;
  const Chevron = edge === "l" ? ChevronRight : edge === "r" ? ChevronLeft : edge === "t" ? ChevronDown : ChevronUp;

  return (
    <>
      <motion.div
        data-win={win.id}
        className={`win${win.dock ? " docked" : ""}${win.pinned ? " pinned" : ""}${win.min ? " gone" : ""}${edge ? ` peeked pk-${edge}` : ""}${lift ? " lifted" : ""}${out ? " out" : ""}${ghost ? " ghosting" : ""}${show.t ? " show-t" : ""}${show.b ? " show-b" : ""}`}
        style={{ x: mx, y: my, width: mw, height: mh, zIndex: win.min ? 39 : 40 + win.z, cursor }}
        role="dialog" aria-label={win.spec.title} aria-hidden={win.min}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: win.min ? 0 : 1, scale: win.min ? 0.14 : lift ? 1.012 : 1 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: "easeOut" } }}
        transition={SPRING.ui}
        onPointerDown={onWinPointerDown}
        onPointerMove={onDragMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerEnter={onPeekEnter}
        onPointerLeave={onPeekBack}
        onPointerMoveCapture={(e) => {
          if (win.min || win.peek || gest.current) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - r.top;
          reveal(y < 52 ? "t" : r.height - y < 52 ? "b" : null);
        }}
      >
        {/* top bar: drag to move or pull a docked panel out; double-click minimizes */}
        <div className="win-bar top" onPointerDown={onBarPointerDown} onPointerMove={onDragMove} onPointerUp={endGesture} onPointerCancel={endGesture}
          onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button") && !win.peek) api.onMin(win.id, true); }}>
          <span className="title">{win.spec.title}</span>
          <button className="ib sm" aria-label={win.pinned ? "Unpin bars" : "Pin bars"} title={win.pinned ? "Unpin bars (bars float over content)" : "Pin bars (part of the layout)"} onClick={() => api.onPin(win.id, !win.pinned)}>{win.pinned ? <PinOff /> : <Pin />}</button>
          <button className="ib sm" aria-label="Minimize" title="Minimize to the rail" onClick={() => api.onMin(win.id, true)}><Minus /></button>
          <button className="ib sm" aria-label="Close" title="Close" onClick={() => api.onClose(win.id)}><X /></button>
        </div>

        {children}

        {/* parked: a designed tab in the visible sliver; content hides behind it */}
        {edge && !win.min && (
          <div className={`peek-tab pk-${edge}${out ? " fade" : ""}`} role="button" aria-label={`Restore ${win.spec.title}`}>
            <kind.Icon />
            <span className="pk-title">{win.spec.title}</span>
            <Chevron size={15} />
          </div>
        )}
        {/* while slid out, a transparent catcher keeps the hover alive over iframes; click restores */}
        {edge && out && !win.min && <div className="peek-catcher" onClick={restorePeek} onPointerLeave={onPeekBack} />}
      </motion.div>

      {/* overlay (never clipped by the window): resize handles, snap previews, dock ghost */}
      <div className="win-overlay" style={{ zIndex: 41 + win.z }}>
        {zone && !ghost && !win.min && !win.peek && (
          <Handle zone={zone} mx={mx} my={my} mw={mw} mh={mh} hx={hx} hy={hy} onDown={startResize} onMove={onDragMove} onUp={endGesture} />
        )}
        {snap.edge && <div className={`snap-preview sn-${snap.edge}`} aria-hidden />}
        {snap.dock && <div className="dock-drop-preview" style={{ width: dockW }} aria-hidden />}
        {ghost && <>
          <motion.div className="dock-ghost" style={{ width: ghostW }} />
          <motion.div className="dock-ghost-size" style={{ right: ghostRight }}>{ghostLabel}</motion.div>
        </>}
      </div>
    </>
  );
});

/** The handle itself: edges get a thin pill that follows the cursor along the edge; corners a small lens.
 *  Pointer capture lands on the pill, so the gesture handlers run here too. */
function Handle({ zone, mx, my, mw, mh, hx, hy, onDown, onMove, onUp }: {
  zone: Zone; mx: MotionValue<number>; my: MotionValue<number>; mw: MotionValue<number>; mh: MotionValue<number>;
  hx: MotionValue<number>; hy: MotionValue<number>;
  onDown: (e: React.PointerEvent, z: Zone) => void; onMove: (e: React.PointerEvent) => void; onUp: () => void;
}) {
  const pill = 46;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  // pill centre follows the cursor, clamped to stay along the window's edge (screen space, live from motion values)
  const pillX = useTransform([hx, mx, mw], ([h, t, w]: number[]) => clamp(h, t + 28, t + w - 28) - pill / 2);
  const pillY = useTransform([hy, my, mh], ([h, t, g]: number[]) => clamp(h, t + 28, t + g - 28) - pill / 2);
  const xL = useTransform(mx, (v) => v - 11);
  const xR = useTransform([mx, mw], ([t, w]: number[]) => t + w + 6);
  const yT = useTransform(my, (v) => v - 11);
  const yB = useTransform([my, mh], ([t, g]: number[]) => t + g + 6);
  const cxL = useTransform(mx, (v) => v - 8), cxR = useTransform([mx, mw], ([t, w]: number[]) => t + w - 6);
  const cyT = useTransform(my, (v) => v - 8), cyB = useTransform([my, mh], ([t, g]: number[]) => t + g - 6);

  const isDot = zone.length === 2;
  const style: Record<string, unknown> = isDot
    ? { x: zone[0] === "l" ? cxL : cxR, y: zone[1] === "t" ? cyT : cyB, width: 14, height: 14 }
    : zone === "l" ? { x: xL, y: pillY, width: 5, height: pill }
    : zone === "r" ? { x: xR, y: pillY, width: 5, height: pill }
    : zone === "t" ? { x: pillX, y: yT, height: 5, width: pill }
    : { x: pillX, y: yB, height: 5, width: pill };
  return (
    <motion.div
      className={`rz-handle${isDot ? " dot" : ""}`}
      style={{ ...style } as never}
      data-zone={zone}
      role="separator"
      aria-label={`Resize ${zone === "l" ? "left" : zone === "r" ? "right" : zone === "t" ? "top" : zone === "b" ? "bottom" : zone === "tl" ? "top-left" : zone === "tr" ? "top-right" : zone === "bl" ? "bottom-left" : "bottom-right"} edge`}
      onPointerDown={(e) => onDown(e, zone)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
