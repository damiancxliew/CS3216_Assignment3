import type { AssetManifest } from "@adventure/generation/assets";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearVersionCache,
  getAssets,
  getVersion,
  setAssets,
  setVersion,
} from "@/lib/play/version-cache";

const version = (id: string) => ({ specVersionId: id, spec: {} as never, compiledStages: [] });
const manifest = (status: "ready" | "pending"): AssetManifest => ({
  adventureId: "adventure",
  specVersion: 1,
  records: [{
    assetId: "asset",
    entityId: "entity",
    kind: "portrait",
    status,
    url: "/asset",
    placeholderUrl: "/placeholder",
    promptHash: "hash",
    model: null,
    costUsd: 0,
    error: null,
  }],
  generatedCount: 0,
  cacheHits: 0,
  totalCostUsd: 0,
  startedAt: "",
  finishedAt: status === "pending" ? null : "",
});

describe("published version cache", () => {
  beforeEach(() => clearVersionCache());

  it("returns cached versions on a hit and misses before insertion", () => {
    expect(getVersion("adventure", 1)).toBeUndefined();
    setVersion("adventure", 1, version("version-1"));
    expect(getVersion("adventure", 1)).toEqual(version("version-1"));
  });

  it("evicts the oldest insertion after sixteen entries", () => {
    for (let index = 0; index < 16; index += 1) setVersion("adventure", index, version(`version-${index}`));
    expect(getVersion("adventure", 0)).toBeDefined();
    setVersion("adventure", 16, version("version-16"));
    expect(getVersion("adventure", 0)).toBeUndefined();
    expect(getVersion("adventure", 16)).toBeDefined();
  });

  it("does not cache pending manifests", () => {
    setAssets("spec-version", manifest("pending"));
    expect(getAssets("spec-version")).toBeUndefined();
    setAssets("spec-version", manifest("ready"));
    expect(getAssets("spec-version")).toEqual(manifest("ready"));
  });
});
