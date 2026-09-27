"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Search, Sparkles, Terminal, Globe } from "lucide-react";

const CHIPS: { q: string; icon: typeof Search }[] = [
  { q: "What changed in Next.js 16?", icon: Globe },
  { q: "Explain the Reimann hypothesis simply", icon: Sparkles },
  { q: "Run the tests in this repo", icon: Terminal },
  { q: "Latest SpaceX launch", icon: Globe },
];

/**
 * The app opens here: one centred question box, no chat chrome. Answers are temporary — they live in
 * History, not in Chats, and the button on a history row promotes one into a real chat.
 */
export function SearchHome({ onAsk, busy }: { onAsk: (q: string) => void; busy?: boolean }) {
  const [v, setV] = useState("");
  const [sel, setSel] = useState(-1);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const send = (q: string) => { const t = q.trim(); if (!t || busy) return; onAsk(t); setV(""); };
  return (
    <div className="home">
      <div className="home-mark">
        <span className="home-word">final-chat</span>
        <span className="home-sub">Ask anything. Search the web. Or tell it to run something — it becomes a chat.</span>
      </div>
      <form className="home-box" onSubmit={(e) => { e.preventDefault(); send(v); }}>
        <Search className="home-ico" />
        <textarea ref={ref} rows={1} value={v} placeholder="Ask, search, or give a command…" aria-label="Search or ask"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(v); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(CHIPS.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(-1, s - 1)); }
          }} />
        <button className="home-go" type="submit" aria-label="Ask" disabled={!v.trim() || !!busy}><ArrowUp /></button>
      </form>
      <div className="home-chips">
        {CHIPS.map((c, i) => { const I = c.icon; return (
          <button key={c.q} className={"chip" + (sel === i ? " on" : "")} onClick={() => send(c.q)} onMouseEnter={() => setSel(i)}>
            <I />{c.q}
          </button>); })}
      </div>
      <div className="home-foot">
        Answers are checked against the pages they cite. Temporary ones sit in History — press <kbd>Keep as chat</kbd> to hold on to one.
      </div>
    </div>
  );
}
