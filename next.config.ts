import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname || process.cwd()),
  },
  serverExternalPackages: ["@electric-sql/pglite", "mammoth", "node-tikzjax", "node-pty"],
  // the preview host, plus the loopback spellings the dev scripts use ("127.0.0.1" counts as cross-origin
  // here, and a blocked dev resource means the page renders but never hydrates — silent, and hard to spot)
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "127.0.0.1", "localhost"],
};

export default nextConfig;
