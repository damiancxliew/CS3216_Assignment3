import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Runs `scripts/measure-play-cost.ts` as a one-shot task (real model calls) with the workspace aliases; not part of `npm test`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/measure-play-cost.ts"],
    testTimeout: 1_800_000,
    reporters: ["dot"],
  },
});
