import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Runs `scripts/seed-demo.ts` as a one-shot task with the workspace aliases; not part of `npm test`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/seed-demo.ts"],
    testTimeout: 120_000,
    reporters: ["dot"],
  },
});
