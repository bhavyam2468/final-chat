import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  context: jsonb("context").$type<string[]>().notNull().default([]),
  summary: text("summary"),
  summaryUpTo: text("summary_up_to"),
  /** Harness state: loaded tool packs (kept so the tool list stays stable across turns) and the task checklist. */
  state: jsonb("state").$type<{ packs?: "dev"[]; todo?: { text: string; status: "todo" | "doing" | "done" }[]; approved?: string[] }>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Part =
  | { type: "text"; text: string; unverified?: string[] }
  | { type: "reasoning"; text: string; ms?: number }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown>; result?: string; ok?: boolean; meta?: unknown; compact?: string; out?: string };

export type Attachment = { path: string; name: string; mime: string; size: number };

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    parentId: text("parent_id"),
    threadOf: text("thread_of"),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    parts: jsonb("parts").$type<Part[]>().notNull().default([]),
    attachments: jsonb("attachments").$type<Attachment[]>().notNull().default([]),
    quote: text("quote"),
    /** Selective compaction: null = full, "" = folded into an earlier message's summary, text = summary replacing this message (and following "" ones). */
    compact: text("compact"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conv_idx").on(t.conversationId)]
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
