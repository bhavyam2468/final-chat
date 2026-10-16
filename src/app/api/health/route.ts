import { DESKTOP, APP_VERSION, describePaths } from "@/lib/paths";
import { db, schemaReady } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Readiness probe. The desktop shell polls this while its splash is up: 200 means the app is
 * usable (schema migrated, database answering), 500 means it is not ready yet — the shell keeps
 * polling, then shows the log tail if it never turns green.
 */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    await schemaReady().catch(() => {});
    return Response.json({
      ok: true,
      version: APP_VERSION || null,
      mode: DESKTOP ? "desktop" : "web",
      uptime: Math.round(process.uptime()),
      db: process.env.DATABASE_URL ? "postgres" : "pglite",
      searxng: process.env.SEARXNG_URL || null,
      ms: Date.now() - started,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, paths: DESKTOP ? describePaths() : undefined }, { status: 500 });
  }
}
