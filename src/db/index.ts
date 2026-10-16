import { drizzle as drizzlePg, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PGLITE_DIR } from "../lib/paths";

/**
 * Two drivers, one schema:
 * - DATABASE_URL set  -> real Postgres (any server).
 * - DATABASE_URL unset -> embedded Postgres (PGlite, WASM) stored in PGLITE_DIR
 *   (./data/pglite in web mode, <app data>/data/pglite in the desktop app).
 *   Zero-install local mode: `npm i && npm run build && npm start` just works.
 * Schema is created idempotently on first use, so `drizzle-kit push` is optional.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY, title text NOT NULL DEFAULT '', context jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text, summary_up_to text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY, conversation_id text NOT NULL, parent_id text, thread_of text, role text NOT NULL,
  content text NOT NULL DEFAULT '', parts jsonb NOT NULL DEFAULT '[]'::jsonb, attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  quote text, created_at timestamp NOT NULL DEFAULT now());
ALTER TABLE messages ADD COLUMN IF NOT EXISTS compact text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS state jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
`;

type G = typeof globalThis & {
  __wsDb?: NodePgDatabase;
  __wsPool?: Pool;
  __wsLite?: { close: () => Promise<void> };
  __wsSchema?: Promise<void>;
};
const g = globalThis as G;

function make(): NodePgDatabase {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = (g.__wsPool ??= new Pool({ connectionString: url }));
    g.__wsSchema ??= pool.query(DDL).then(() => undefined).catch((e) => console.warn("[db] schema init:", e.message));
    return drizzlePg(pool);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzleLite } = require("drizzle-orm/pglite");
  require("fs").mkdirSync(PGLITE_DIR, { recursive: true });
  const client = new PGlite(PGLITE_DIR);
  g.__wsLite = client;
  // PGlite serialises queries, so DDL issued first always runs before app queries.
  g.__wsSchema ??= client.exec(DDL).then(() => undefined);
  return drizzleLite(client) as NodePgDatabase;
}

/**
 * `db` must not open the database on import: Next's build imports every route module to
 * collect its config, and an import-time PGlite open would (a) slow every build and
 * (b) fight over ./data/pglite with a dev server running elsewhere — two WASM Postgres
 * instances on one directory abort each other. The proxy defers make() to the first real
 * query, so builds touch nothing and the first request opens the database once.
 */
export const db: NodePgDatabase = new Proxy({} as NodePgDatabase, {
  get(_t, prop) {
    const d = (g.__wsDb ??= make());
    const v = Reflect.get(d as object, prop, d);
    return typeof v === "function" ? v.bind(d) : v;
  },
});
export const schemaReady = () => g.__wsSchema ?? Promise.resolve();

/**
 * Close the database cleanly. The desktop shell asks the server to stop before it exits, and
 * PGlite writes its WAL on close — skipping this means replaying (or losing) the last writes.
 * Safe to call when no database was ever opened: it is then a no-op.
 */
export async function closeDb(): Promise<void> {
  await (g.__wsSchema ?? Promise.resolve()).catch(() => {});
  const lite = g.__wsLite;
  g.__wsLite = undefined;
  g.__wsDb = undefined;
  g.__wsSchema = undefined;
  const pool = g.__wsPool;
  g.__wsPool = undefined;
  if (lite) await lite.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
}
