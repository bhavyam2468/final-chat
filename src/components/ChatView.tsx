"use client";
import { useEffect, useMemo, useState } from "react";
import { StreamMarkdown } from "@/lib/streammark/StreamMarkdown";
import { Msg, useApp } from "./ctx";
import { useMdHandlers } from "./Message";

/** A conversation shown in a canvas window (read-only, follows along while it runs): several chats side by side. */
export function ChatView({ id, setBar }: { id: string; setBar: (n: React.ReactNode) => void }) {
  const app = useApp();
  const md = useMdHandlers();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stop = false;
    const load = () => fetch(`/api/conversations/${id}`).then((r) => r.json()).then((j) => { if (stop) return; if (j.error) setErr(j.error); else setMsgs(j.messages); }).catch(() => !stop && setErr("Could not load"));
    load();
    const t = setInterval(load, 4000); // cheap: one small JSON; keeps a running chat current
    return () => { stop = true; clearInterval(t); };
  }, [id]);
  useEffect(() => { setBar(<button className="txt-btn" onClick={() => app.openChat(id)}>Open in chat</button>); }, [id, app, setBar]);
  // main line: follow the newest leaf back to the root (side threads and old branches stay out)
  const line = useMemo(() => {
    if (!msgs) return [];
    const main = msgs.filter((m) => !m.threadOf);
    const byId = new Map(main.map((m) => [m.id, m]));
    let cur = [...main].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
    const out: Msg[] = [];
    while (cur) { out.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId)! : (undefined as unknown as Msg); }
    return out;
  }, [msgs]);
  if (err) return <div className="v-msg">{err}</div>;
  if (!msgs) return <div className="v-msg">Loading…</div>;
  return (
    <div className="reader chatview">
      {line.map((m) => m.role === "user"
        ? <div key={m.id} className="cv-user">{m.content.replace(/<ui_event[\s\S]*?<\/ui_event>/g, "(form sent)")}</div>
        : <div key={m.id} className="cv-ai">
          {m.parts.map((p, i) => p.type === "text" ? <StreamMarkdown key={i} text={p.text} {...md} />
            : p.type === "tool" ? <div key={i} className="cv-tool">{p.name.replace(/_/g, " ")}{typeof p.args?.path === "string" ? " · " + p.args.path : typeof p.args?.query === "string" ? " · " + p.args.query : ""}{p.ok === false ? " ✗" : ""}</div>
            : null)}
        </div>)}
    </div>
  );
}
