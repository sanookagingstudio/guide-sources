import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The bridge draft store talks to PostgreSQL with the `postgres` driver from a
  // Node runtime route; keep it a real server dependency instead of bundling it.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
