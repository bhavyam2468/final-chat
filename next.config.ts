import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname || process.cwd()),
  },
  serverExternalPackages: ["@electric-sql/pglite", "mammoth", "node-tikzjax", "node-pty"],
  // dev resources (HMR, client chunks) are origin-checked; without these the page loads but never hydrates
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "localhost", "127.0.0.1", "0.0.0.0"],
};

export default nextConfig;
