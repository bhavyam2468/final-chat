"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Plus, ArrowUp, Square, X, FileText, Hash, File as FileIcon, Folder, Compass, Clock, RotateCcw, ChevronRight, FolderTree } from "lucide-react";
import { Attachment, flatFiles, fileUrl, useApp, TreeNode } from "./ctx";
import { chatDir } from "@/lib/shared";

export type SendPayload = { content: string; attachments: Attachment[]; quote: string | null };
export type ComposerHandle = { insert: (t: string) => void; focus: () => void; addFiles: (f: FileList | File[]) => void };
export type Command = { name: string; hint: string; run: (arg?: string) => void };

type Chip = Attachment & { loading?: boolean; key: string; preview?: string };

type Props = {
  onSend: (p: SendPayload) => void;
  streaming?: boolean;
  onStop?: () => void;
  onQueue?: (p: SendPayload) => void;
  onSteer?: (p: SendPayload) => void;
  queued?: SendPayload[];
  onRemoveQueued?: (index: number) => void;
  quote?: string | null;
  onClearQuote?: () => void;
  inline?: boolean;
  capture?: boolean;
  commands?: Command[];
  initial?: SendPayload;
  onCancel?: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  /** per-chat draft: text + attachments survive chat switches and reloads */
  draftKey?: string;
};

type Draft = { text: string; chips: Attachment[] };
const readDraft = (k: string): Draft | null => { try { return JSON.parse(localStorage.getItem("draft:" + k) || "null"); } catch { return null; } };

export async function upload(files: File[], dir?: string): Promise<Attachment[]> {
  const fd = new FormData();
  if (dir) fd.append("dir", dir);
  files.forEach((f) => fd.append("files", f));
  const r = await fetch("/api/workspace/upload", { method: "POST", body: fd });
  return r.json();
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(p, ref) {
  const app = useApp();
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(p.initial?.content || "");
  const [chips, setChips] = useState<Chip[]>(() => (p.initial?.attachments || []).map((a) => ({ ...a, key: a.path })));
  const [focused, setFocused] = useState(false);
  const [drag, setDrag] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [caret, setCaret] = useState(0);

  // Keyboard navigation folder path for /workspace mode
  const [wsDir, setWsDir] = useState<string>("");

  // drafts: save on change, load when draftKey changes
  const keyRef = useRef(p.draftKey);
  useEffect(() => {
    if (!p.draftKey) return;
    keyRef.current = p.draftKey;
    const d = readDraft(p.draftKey);
    setText(d?.text || "");
    setChips((d?.chips || []).map((a) => ({ ...a, key: a.path })));
  }, [p.draftKey]);

  useEffect(() => {
    const k = keyRef.current;
    if (!k) return;
    const done = chips.filter((c) => !c.loading).map(({ path, name, mime, size }) => ({ path, name, mime, size }));
    if (!text && !done.length) localStorage.removeItem("draft:" + k);
    else localStorage.setItem("draft:" + k, JSON.stringify({ text, chips: done }));
  }, [text, chips]);

  // Jitter-free autosize: Avoid resetting height to auto unless characters were removed
  const prevLen = useRef(text.length);
  const autosize = useCallback(() => {
    const t = ta.current;
    if (!t) return;
    const maxH = Math.round(window.innerHeight * 0.4);
    if (text.length < prevLen.current || !text) {
      t.style.height = "auto";
    }
    prevLen.current = text.length;
    const targetH = Math.min(Math.max(34, t.scrollHeight), maxH);
    t.style.height = `${targetH}px`;
  }, [text]);

  useEffect(() => {
    autosize();
  }, [text, autosize]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const files = [...list];
    if (!files.length) return;
    const temp: Chip[] = files.map((f) => ({
      key: Math.random().toString(36),
      path: "",
      name: f.name,
      mime: f.type,
      size: f.size,
      loading: true,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setChips((c) => [...c, ...temp]);
    try {
      const res = await upload(files, app.convId ? chatDir(app.convId) + "/uploads" : undefined);
      setChips((c) =>
        c.map((x) => {
          const i = temp.findIndex((t) => t.key === x.key);
          return i < 0 ? x : { ...x, ...res[i], loading: false };
        })
      );
      app.refreshTree();
    } catch {
      setChips((c) => c.filter((x) => !temp.some((t) => t.key === x.key)));
    }
  }, [app]);

  useImperativeHandle(ref, () => ({
    insert: (t: string) => {
      setText((v) => (v && !v.endsWith(" ") ? v + " " : v) + t);
      setTimeout(() => ta.current?.focus(), 0);
    },
    focus: () => ta.current?.focus(),
    addFiles,
  }), [addFiles]);

  // Type-anywhere capture
  useEffect(() => {
    if (!p.capture) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], iframe")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && !document.querySelector(".scrim")) ta.current?.focus();
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.("input, textarea, select, [contenteditable=true], iframe") || document.querySelector(".scrim") || !e.clipboardData) return;
      const files = [...e.clipboardData.files];
      const txt = e.clipboardData.getData("text/plain");
      if (!files.length && !txt) return;
      e.preventDefault();
      if (files.length) addFiles(files);
      if (txt) {
        const el = ta.current;
        const at = el ? el.selectionStart ?? el.value.length : 0;
        setText((v) => {
          const i = el && document.activeElement === el ? at : v.length;
          return v.slice(0, i) + txt + v.slice(i);
        });
        requestAnimationFrame(() => {
          const el2 = ta.current;
          if (!el2) return;
          el2.focus();
          const c = el2.value.length;
          el2.setSelectionRange(c, c);
        });
      } else ta.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [p.capture, addFiles]);

  useEffect(() => { if (p.autoFocus) ta.current?.focus(); }, [p.autoFocus]);
  useEffect(() => { if (p.quote) ta.current?.focus(); }, [p.quote]);

  // Command & mention parsing
  const before = text.slice(0, caret);
  const mentionQ = before.match(/(?:^|\s)@([\w./~-]*)$/)?.[1];
  const slash = text.match(/^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i);
  const cmdName = slash?.[1]?.toLowerCase();
  const cmdArg = slash?.[2] || "";

  // Dedicated modes when commands expand the input bar
  const isChatsMode = cmdName === "chats" && !text.includes("\n");
  const isWorkspaceMode = cmdName === "workspace" && !text.includes("\n");
  const isRollbackMode = cmdName === "rollback" && !text.includes("\n");

  // Flat files with current chat's uploads placed first!
  const availableFiles = useMemo(() => {
    const all = flatFiles(app.tree);
    const convUploadPrefix = app.convId ? `chats/${app.convId}/uploads/` : "uploads/";
    const myUploads = all.filter((f) => f.path.startsWith(convUploadPrefix));
    const rest = all.filter((f) => !f.path.startsWith(convUploadPrefix));
    return [...myUploads, ...rest];
  }, [app.tree, app.convId]);

  // Expanded items for popup / navigation list
  type Item = { key: string; label: string; hint: string; icon: typeof Hash; run: () => void; isDir?: boolean; path?: string };
  const items: Item[] = useMemo(() => {
    if (isChatsMode) {
      const q = cmdArg.toLowerCase().trim();
      const list = (app.convList || []).filter((c) => !q || c.title.toLowerCase().includes(q));
      return list.map((c) => ({
        key: c.id,
        label: c.title || "Untitled chat",
        hint: c.mode === "search" ? "Search" : "Chat",
        icon: FileText,
        run: () => {
          setText("");
          app.openChat(c.id);
        },
      }));
    }

    if (isWorkspaceMode) {
      // Find current directory node in tree
      const findDir = (nodes: TreeNode[], dir: string): TreeNode | null => {
        if (!dir) return { name: "workspace", path: "", dir: true, children: nodes };
        for (const n of nodes) {
          if (n.path === dir) return n;
          if (n.dir && dir.startsWith(n.path + "/")) {
            const res = findDir(n.children || [], dir);
            if (res) return res;
          }
        }
        return null;
      };

      const currNode = findDir(app.tree, wsDir);
      const kids = currNode?.children || app.tree;
      const list: Item[] = [];

      if (wsDir) {
        list.push({
          key: "..",
          label: ".. (up one folder)",
          hint: wsDir,
          icon: Folder,
          isDir: true,
          path: wsDir.includes("/") ? wsDir.slice(0, wsDir.lastIndexOf("/")) : "",
          run: () => setWsDir((d) => (d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "")),
        });
      }

      for (const k of kids) {
        list.push({
          key: k.path,
          label: k.name,
          hint: k.path,
          icon: k.dir ? Folder : FileIcon,
          isDir: k.dir,
          path: k.path,
          run: () => {
            if (k.dir) {
              setWsDir(k.path);
            } else {
              setText("");
              app.openFile(k.path);
            }
          },
        });
      }
      return list;
    }

    if (isRollbackMode) {
      const scopes = [
        { id: "all", label: "Rollback all defaults", hint: "Restore SYSTEM.md, AGENTS.md, memory, skills, mcp" },
        { id: "system", label: "Rollback SYSTEM.md", hint: "Restore core system prompt" },
        { id: "agents", label: "Rollback AGENTS.md", hint: "Restore agent memory instructions" },
        { id: "memory", label: "Reset Memory", hint: "Reset profile.md and episodic memories" },
        { id: "skills", label: "Rollback Skills", hint: "Restore built-in skills" },
        { id: "mcp", label: "Rollback MCP Servers", hint: "Reset servers.json to template" },
      ];
      return scopes.map((s) => ({
        key: s.id,
        label: s.label,
        hint: s.hint,
        icon: RotateCcw,
        run: async () => {
          setText("");
          const res = await fetch("/api/workspace/restore", { method: "POST", body: JSON.stringify({ scope: s.id }) });
          const j = await res.json().catch(() => ({}));
          app.refreshTree();
          app.sendText(`[Rollback complete] Restored: ${s.label} (${(j.restored || []).join(", ")})`);
        },
      }));
    }

    // Default slash commands
    if (cmdName !== undefined && p.commands && !isChatsMode && !isWorkspaceMode && !isRollbackMode) {
      return p.commands
        .filter((c) => c.name.startsWith(cmdName))
        .map((c) => ({
          key: c.name,
          label: "/" + c.name,
          hint: c.hint,
          icon: Hash,
          run: () => {
            if (c.name === "chats" || c.name === "workspace" || c.name === "rollback") {
              setText("/" + c.name + " ");
            } else {
              setText("");
              c.run(cmdArg.trim());
            }
          },
        }));
    }

    // @mentions popup
    if (mentionQ !== undefined) {
      return availableFiles
        .filter((f) => f.path.toLowerCase().includes(mentionQ.toLowerCase()))
        .slice(0, 10)
        .map((f) => ({
          key: f.path,
          label: f.name,
          hint: f.path,
          icon: FileIcon,
          run: () => {
            const start = before.lastIndexOf("@");
            const nt = text.slice(0, start) + "@" + f.path + " " + text.slice(caret);
            setText(nt);
            setTimeout(() => {
              const c = start + f.path.length + 2;
              ta.current?.setSelectionRange(c, c);
              setCaret(c);
            }, 0);
          },
        }));
    }

    return [];
  }, [isChatsMode, isWorkspaceMode, isRollbackMode, cmdName, cmdArg, wsDir, app, p.commands, mentionQ, availableFiles, before, text, caret]);

  useEffect(() => setMenuIdx(0), [items.length]);

  const ready = chips.every((c) => !c.loading);
  const canSend = (text.trim() || chips.length) && ready;

  const currentPayload = (): SendPayload => ({
    content: text.trim(),
    attachments: chips.map(({ path, name, mime, size }) => ({ path, name, mime, size })),
    quote: p.quote || null,
  });

  const send = () => {
    if (!canSend) return;
    if (p.streaming) {
      // If streaming, send automatically routes to Queue!
      p.onQueue?.(currentPayload());
    } else {
      p.onSend(currentPayload());
    }
    setText("");
    setChips([]);
    p.onClearQuote?.();
  };

  const steer = () => {
    if (!canSend) return;
    p.onSteer?.(currentPayload());
    setText("");
    setChips([]);
    p.onClearQuote?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIdx((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIdx((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (isWorkspaceMode) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const cur = items[menuIdx];
          if (cur && cur.isDir && cur.path) {
            setWsDir(cur.path);
            setMenuIdx(0);
          }
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setWsDir((d) => (d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : ""));
          setMenuIdx(0);
          return;
        }
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        items[menuIdx]?.run();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === "Escape") {
      if (isChatsMode || isWorkspaceMode || isRollbackMode) {
        setText("");
        return;
      }
      if (p.onCancel) p.onCancel();
      else ta.current?.blur();
      return;
    }
    if (e.key === "Backspace" && !text && !chips.length) {
      if (p.quote) {
        p.onClearQuote?.();
        return;
      }
      e.preventDefault();
      if (p.onCancel) p.onCancel();
      else ta.current?.blur();
    }
  };

  const open = p.inline || focused || !!text || chips.length > 0 || !!p.quote || isChatsMode || isWorkspaceMode;
  const isExpandedMenu = isChatsMode || isWorkspaceMode || isRollbackMode;

  return (
    <div
      className={`composer${open ? " open" : ""}${p.inline ? " inline" : ""}${drag ? " drag" : ""}${isExpandedMenu ? " expanded-nav" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
    >
      {/* Queued prompt status banner */}
      {p.queued && p.queued.length > 0 && (
        <div className="c-queued-bar">
          <Clock size={13} />
          <span className="cq-msg">{p.queued.length} queued: &ldquo;{p.queued[0].content.slice(0, 50)}&rdquo;</span>
          <button className="ib sm" aria-label="Cancel queued prompt" onClick={() => p.onRemoveQueued?.(0)}><X size={12} /></button>
        </div>
      )}

      {/* Expanded Inline Navigator (Chats, Workspace, Rollback, or @mentions) */}
      {items.length > 0 && (focused || isExpandedMenu) && (
        <div className={`menu${isExpandedMenu ? " nav-expanded" : ""}`} role="listbox">
          {isWorkspaceMode && (
            <div className="menu-header">
              <FolderTree size={14} />
              <span>Workspace: {wsDir || "/ (root)"}</span>
              <small>ArrowRight=enter · ArrowLeft=up · Enter=open</small>
            </div>
          )}
          {isChatsMode && (
            <div className="menu-header">
              <FileText size={14} />
              <span>Switch Chat</span>
              <small>Arrow keys navigate · Enter opens</small>
            </div>
          )}
          {isRollbackMode && (
            <div className="menu-header">
              <RotateCcw size={14} />
              <span>Rollback to Defaults</span>
              <small>Select scope to restore</small>
            </div>
          )}
          <div className="menu-items">
            {items.map((it, i) => {
              const I = it.icon;
              return (
                <button
                  key={it.key}
                  className={i === menuIdx ? "on" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    it.run();
                  }}
                >
                  <I />
                  <span className="it-lbl">{it.label}</span>
                  <small>{it.hint}</small>
                  {it.isDir && <ChevronRight size={13} className="it-arr" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {p.quote && (
        <div className="cquote">
          <p>{p.quote}</p>
          <button className="ib sm" aria-label="Remove quote" onClick={p.onClearQuote}><X /></button>
        </div>
      )}

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => {
            const isImg = c.mime.startsWith("image/");
            return (
              <div key={c.key} className={`chip${isImg ? " img" : ""}${c.loading ? " loading" : ""}`} title={c.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {isImg ? <img src={c.preview || fileUrl(c.path)} alt={c.name} /> : <><FileText size={14} /><span>{c.name}</span></>}
                <button className="x" aria-label="Remove" onClick={() => setChips((x) => x.filter((y) => y.key !== c.key))}><X /></button>
              </div>
            );
          })}
        </div>
      )}

      <div className="row">
        <button className="ib" aria-label="Attach" onClick={() => fileIn.current?.click()}><Plus /></button>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={p.streaming ? "Queue a follow-up or steer the AI..." : undefined}
          aria-label="Message"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown}
          onFocus={() => { setFocused(true); p.onFocus?.(); }}
          onBlur={() => setFocused(false)}
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } }}
        />
        {p.streaming ? (
          canSend ? (
            <div className="streaming-actions">
              <button className="send queue-btn" aria-label="Queue prompt" title="Queue for next turn (Enter)" onClick={send}>
                <Clock size={15} />
              </button>
              <button className="send steer-btn" aria-label="Steer AI" title="Steer AI immediately" onClick={steer}>
                <Compass size={15} />
              </button>
              <button className="send stop-btn" aria-label="Stop" title="Stop" onClick={p.onStop}>
                <Square fill="currentColor" size={13} />
              </button>
            </div>
          ) : (
            <button className="send" aria-label="Stop" onClick={p.onStop}><Square fill="currentColor" /></button>
          )
        ) : canSend ? (
          <button className="send" aria-label="Send" onClick={send}><ArrowUp /></button>
        ) : null}
      </div>
    </div>
  );
});
