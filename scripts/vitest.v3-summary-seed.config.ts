import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/v3-seed-summary.ts"],
    testTimeout: 120_000,
    reporters: ["dot"],
  },
});
