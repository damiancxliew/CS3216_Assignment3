import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source, not a build artifact.
  transpilePackages: ["@adventure/generation"],
  experimental: {
    // Source uploads go through a server action, and the default cap is 1 MB —
    // below the 15 MB the extractor itself allows for a PDF.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
