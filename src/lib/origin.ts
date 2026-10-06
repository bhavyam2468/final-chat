import type { NextRequest } from "next/server";

/** Public origin of this app: behind a proxy the forwarded headers are the truth, not req.url. */
export function originOf(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] || new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0] || req.headers.get("host") || new URL(req.url).host;
  return `${proto}://${host}`;
}
