import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Runs the sysadmin grant script as a one-shot task. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/grant-sysadmin.ts"],
    testTimeout: 120_000,
    reporters: ["dot"],
  },
});
