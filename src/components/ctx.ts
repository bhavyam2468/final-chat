"use client";
import { createContext, useContext } from "react";

export type Part =
  | { type: "text"; text: string; unverified?: string[] }
  | { type: "reasoning"; id?: string; text: string; ms?: number; startedAt?: number }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown>; result?: string; ok?: boolean; meta?: unknown; compact?: string; startedAt?: number; status?: string; live?: string };
export type Attachment = { path: string; name: string; mime: string; size: number };
/** A message waiting in the input bar while the AI responds; it sends when the turn ends. */
export type QueueItem = { id: string; content: string; attachments: Attachment[]; createdAt: number };
/** An agent-started background process, as shown on the input bar. */
export type ProcInfo = { name: string; running: boolean; exit: number | null; ports: number[]; host: boolean; command: string; cwd?: string; started: number; pid: number; tail: string };
export type Msg = {
  id: string; conversationId: string; parentId: string | null; threadOf: string | null; role: "user" | "assistant";
  content: string; parts: Part[]; attachments: Attachment[]; quote: string | null; createdAt: string; pending?: boolean; compact?: string | null; streamStartedAt?: number;
};
export type Conv = { id: string; title: string; context: string[]; summary: string | null; summaryUpTo: string | null; mode?: "chat" | "general"; state?: { mode?: string; project?: string } };
export type TreeNode = { name: string; path: string; dir: boolean; size?: number; children?: TreeNode[] };
export type CanvasSpec =
  | { kind: "ui"; title: string; source: string; path?: string }
  | { kind: "file"; title: string; path: string }
  | { kind: "youtube"; title: string; id: string }
  | { kind: "md"; title: string; body: string }
  | { kind: "web"; title: string; url: string }
  | { kind: "chat"; title: string; id: string }
  /** live terminal in a window: a fresh session, an existing one, or an agent process's log */
  | { kind: "term"; title: string; id?: string; host?: boolean; proc?: string };
export type OpenOpts = { dock?: boolean };

export type AppApi = {
  openFile: (path: string) => void;
  openCanvas: (c: CanvasSpec, o?: OpenOpts) => void;
  /** open a terminal window: a fresh sandbox/host session or the log of an agent-started process */
  openTerm: (o?: { id?: string; host?: boolean; proc?: string; title?: string }) => void;
  sendUiEvent: (data: unknown, opts?: { label?: string; prompt?: string }) => void;
  sendText: (text: string) => void;
  /** Approve / deny a command the harness held back (tool meta.approval). */
  decide: (messageId: string, partId: string, decision: "approve" | "deny", cmd: string, password?: string) => Promise<string | null>;
  refreshTree: () => void;
  mention: (path: string) => void;
  /** put files into the composer as attachments (used by snip-to-input and drops) */
  addFiles: (files: File[]) => void;
  quote: (text: string) => void;
  tree: TreeNode[];
  context: string[];
  toggleContext: (path: string) => void;
  /** current chat (null = new, unsaved) and chat titles, for per-chat folders */
  convId: string | null;
  convTitles: Record<string, string>;
  openChat: (id: string) => void;
};
export const AppCtx = createContext<AppApi | null>(null);
export const useApp = () => useContext(AppCtx)!;

export const fileUrl = (p: string) => "/files/" + p.split("/").map(encodeURIComponent).join("/");
export const flatFiles = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((n) => (n.dir ? flatFiles(n.children || []) : [n]));
export const isExternal = (h: string) => /^(https?:|mailto:|#)/.test(h);
