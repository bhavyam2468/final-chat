import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname || process.cwd()),
  },
  serverExternalPackages: ["@electric-sql/pglite", "mammoth", "node-tikzjax"],
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
};

export default nextConfig;
