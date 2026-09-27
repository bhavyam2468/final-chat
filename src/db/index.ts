import { drizzle as drizzlePg, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import path from "path";

/**
 * Two drivers, one schema:
 * - DATABASE_URL set  -> real Postgres (docker-compose db, or any server)
 * - DATABASE_URL unset -> embedded Postgres (PGlite, WASM) stored in ./data/pglite.
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

type G = typeof globalThis & { __wsDb?: NodePgDatabase; __wsPool?: Pool; __wsSchema?: Promise<void> };
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
  const dir = path.resolve(process.env.PGLITE_DIR || "./data/pglite");
  require("fs").mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  // PGlite serialises queries, so DDL issued first always runs before app queries.
  g.__wsSchema ??= client.exec(DDL).then(() => undefined);
  return drizzleLite(client) as NodePgDatabase;
}

// Do not open an embedded database during next build / route discovery. Build workers are
// short-lived and must never share a data directory with the running application.
const instance = () => (g.__wsDb ??= make());
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, key) {
    const client = instance();
    const value = Reflect.get(client, key, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
export const schemaReady = () => { instance(); return g.__wsSchema ?? Promise.resolve(); };
