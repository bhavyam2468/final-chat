"use client";
import { createContext, useContext } from "react";

export type Part =
  | { type: "text"; text: string; unverified?: string[] }
  | { type: "reasoning"; text: string; ms?: number }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown>; result?: string; ok?: boolean; meta?: unknown; compact?: string };
export type Attachment = { path: string; name: string; mime: string; size: number };
export type Msg = {
  id: string; conversationId: string; parentId: string | null; threadOf: string | null; role: "user" | "assistant";
  content: string; parts: Part[]; attachments: Attachment[]; quote: string | null; createdAt: string; pending?: boolean; compact?: string | null;
};
export type Conv = { id: string; title: string; context: string[]; summary: string | null; summaryUpTo: string | null };
export type TreeNode = { name: string; path: string; dir: boolean; size?: number; children?: TreeNode[] };
export type CanvasSpec =
  | { kind: "ui"; title: string; source: string; path?: string }
  | { kind: "file"; title: string; path: string }
  | { kind: "youtube"; title: string; id: string }
  | { kind: "md"; title: string; body: string }
  | { kind: "web"; title: string; url: string };
export type OpenOpts = { dock?: boolean };

export type AppApi = {
  openFile: (path: string) => void;
  openCanvas: (c: CanvasSpec, o?: OpenOpts) => void;
  sendUiEvent: (data: unknown, opts?: { label?: string; prompt?: string }) => void;
  sendText: (text: string) => void;
  /** Approve / deny a command the harness held back (tool meta.approval). */
  decide: (messageId: string, partId: string, decision: "approve" | "deny", cmd: string) => Promise<void>;
  refreshTree: () => void;
  mention: (path: string) => void;
  quote: (text: string) => void;
  tree: TreeNode[];
  context: string[];
  toggleContext: (path: string) => void;
};
export const AppCtx = createContext<AppApi | null>(null);
export const useApp = () => useContext(AppCtx)!;

export const fileUrl = (p: string) => "/files/" + p.split("/").map(encodeURIComponent).join("/");
export const flatFiles = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((n) => (n.dir ? flatFiles(n.children || []) : [n]));
export const isExternal = (h: string) => /^(https?:|mailto:|#)/.test(h);
