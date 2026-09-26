"use client";
/* useSmoothText — turns bursty network chunks into a steady reveal.
   Reveal speed tracks the measured arrival rate (EMA), accelerates when a backlog builds so we never
   lag more than ~0.7s, snaps to word boundaries, and drains fast once the stream ends.
   Markup-only regions (<ui>…</ui> source) are revealed at drain speed: the Blocks runtime paces those itself. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_CPS = 45, MAX_LAG = 0.7, DRAIN = 0.22;

function insideUi(t: string, i: number) {
  const o = t.lastIndexOf("<ui", i), c = t.lastIndexOf("</ui>", i);
  return o > c;
}

export function useSmoothText(text: string, streaming: boolean) {
  const [shown, setShown] = useState(() => (streaming ? "" : text));
  type St = { pos: number; text: string; streaming: boolean; rate: number; lastLen: number; lastT: number; raf: number; prev: number; carry: number; tick?: (t: number) => void };
  const s = useRef<St>({ pos: streaming ? 0 : text.length, text, streaming, rate: 80, lastLen: 0, lastT: 0, raf: 0, prev: 0, carry: 0 });

  // the frame loop lives in the ref: created once, reads the latest text/streaming from it
  useEffect(() => {
    const r = s.current;
    r.tick = (t: number) => {
      const dt = r.prev ? Math.min(0.1, (t - r.prev) / 1000) : 1 / 60;
      r.prev = t;
      const backlog = r.text.length - r.pos;
      if (backlog <= 0) { r.raf = 0; r.prev = 0; return; }
      let cps: number;
      if (!r.streaming) cps = Math.max(backlog / DRAIN, 400);
      else if (insideUi(r.text, r.pos)) cps = Math.max(backlog / 0.12, 600);
      else cps = Math.max(MIN_CPS, r.rate * 0.95, backlog / MAX_LAG);
      r.carry += cps * dt;
      const n = Math.floor(r.carry);
      if (n >= 1) {
        r.carry -= n;
        let next = Math.min(r.text.length, r.pos + n);
        // snap forward to the end of the current word (keeps words whole; max 14 chars look-ahead)
        if (next < r.text.length && /\S/.test(r.text[next])) {
          const m = /\s/.exec(r.text.slice(next, next + 14));
          if (m) next += m.index; else if (r.streaming && r.text.length - next < 14) next = r.pos; // wait for word to finish
        }
        if (next > r.pos) { r.pos = next; setShown(r.text.slice(0, next)); }
      }
      r.raf = requestAnimationFrame(r.tick!);
    };
    return () => { cancelAnimationFrame(r.raf); r.raf = 0; };
  }, []);

  useLayoutEffect(() => { s.current.text = text; s.current.streaming = streaming; }, [text, streaming]);

  // measure incoming rate, (re)start the loop
  useEffect(() => {
    const r = s.current, now = performance.now();
    if (r.lastT) {
      const dt = (now - r.lastT) / 1000, add = text.length - r.lastLen;
      if (dt > 0.01 && add > 0) r.rate = r.rate * 0.7 + Math.min(4000, add / dt) * 0.3;
    }
    r.lastT = now; r.lastLen = text.length;
    if (text.length < r.pos) r.pos = text.length; // text replaced (regenerate / branch)
    if (!r.raf && r.tick) r.raf = requestAnimationFrame(r.tick);
  }, [text, streaming]);

  const settled = !streaming && shown.length >= text.length;
  return { text: settled ? text : shown, live: !settled };
}
