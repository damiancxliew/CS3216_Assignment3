import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source, not a build artifact.
  transpilePackages: [
    "@adventure/generation",
    "@adventure/orchestration",
    "@adventure/game-core",
    "@adventure/game-client",
  ],
  // game-core and game-client import siblings as `./x.js` (Node ESM style) while shipping `.ts`
  // source; tsc and Vite resolve that, webpack needs telling.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    // Phaser's `module` entry has named exports only; `import Phaser from "phaser"` (which Vite
    // interops fine) is undefined under webpack. The UMD build has the default the client expects.
    config.resolve.alias = { ...config.resolve.alias, phaser: require.resolve("phaser/dist/phaser.js") };
    return config;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
  experimental: {
    // Source uploads go through a server action, and the default cap is 1 MB —
    // below the 15 MB the extractor itself allows for a PDF.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
