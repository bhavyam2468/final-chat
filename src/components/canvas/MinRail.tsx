"use client";
/* The minimize rail: a thin vertical pill dock on the left edge of the screen.
   Minimized canvases live here as icons — click to restore (the window flies back out),
   hover for the title, × to close. It appears only while something is parked in it. */
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { kindIcon, Win } from "./types";

export const RAIL = { pad: 10, w: 46, tile: 34, gap: 8 };
const step = RAIL.tile + RAIL.gap;

/** Center of the tile a minimized window flies to (must match the rendered rail exactly). */
export function railIconCenter(index: number, count: number, vp: { w: number; h: number }) {
  const stackH = count * step - RAIL.gap;
  const top = Math.max(RAIL.pad, vp.h / 2 - stackH / 2);
  return { x: RAIL.pad + RAIL.w / 2, y: top + index * step + RAIL.tile / 2 };
}

export function MinRail({ wins, onRestore, onClose }: { wins: Win[]; onRestore: (id: string) => void; onClose: (id: string) => void }) {
  const count = wins.length;
  const stackH = count * step - RAIL.gap;
  const vh = typeof window === "undefined" ? 800 : innerHeight;
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.nav className="min-rail" aria-label="Minimized canvases"
          initial={{ opacity: 0, x: -RAIL.w - RAIL.pad, scale: 0.8 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -RAIL.w - RAIL.pad, scale: 0.8 }}
          transition={{ type: "spring", stiffness: 520, damping: 38 }}
          style={{ top: `calc(50% - ${Math.min(stackH, vh * 0.7) / 2}px)` }}>
          <AnimatePresence initial={false}>
            {wins.map((w, i) => {
              const Icon = kindIcon(w.spec);
              return (
                <motion.div key={w.id} className="rail-item" layout
                  initial={{ opacity: 0, scale: 0.4, x: -14 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.4, x: -14 }}
                  transition={{ type: "spring", stiffness: 560, damping: 34, delay: i * 0.02 }}>
                  <button className="rail-tile" aria-label={`Restore ${w.spec.title}`} title={w.spec.title} onClick={() => onRestore(w.id)}>
                    <Icon />
                  </button>
                  <div className="rail-tip" role="tooltip">
                    <span>{w.spec.title}</span>
                    <button className="ib sm" aria-label={`Close ${w.spec.title}`} onClick={(e) => { e.stopPropagation(); onClose(w.id); }}><X /></button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
