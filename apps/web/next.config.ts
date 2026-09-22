import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source, not a build artifact.
  transpilePackages: ["@adventure/generation"],
};

export default nextConfig;
