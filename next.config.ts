import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "mammoth", "node-tikzjax"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.e2b.app", "*.e2b.dev"],
};

export default nextConfig;
