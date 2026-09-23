import { loadI1Spec } from "@adventure/generation/fixtures";
import { beforeAll, describe, expect, it } from "vitest";

import { compileStageMap, readCompiledStages, SpatialCompatibilityError } from "@/lib/play/layout";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;
let maps: ReturnType<typeof compileStageMap>[];

beforeAll(async () => {
  spec = await loadI1Spec();
  maps = spec.stages.map((stage) => compileStageMap(stage, "stored-maps-test"));
});

describe("stored compiled maps", () => {
  it("reads valid maps detached from the stored value", () => {
    const stored = structuredClone(maps);
    const parsed = readCompiledStages(spec, stored);
    expect(parsed).toEqual(maps);
    parsed[0]!.map.id = "detached";
    expect(stored[0]!.map.id).not.toBe("detached");
  });

  it("rejects missing, wrong-stage, and malformed maps without private details", () => {
    expect(() => readCompiledStages(spec, null)).toThrow(SpatialCompatibilityError);
    const wrong = structuredClone(maps);
    wrong[0]!.map.stageId = "wrong-stage";
    expect(() => readCompiledStages(spec, wrong)).toThrow(SpatialCompatibilityError);
    const malformed = structuredClone(maps) as unknown[];
    malformed[0] = { secret: "private" };
    expect(() => readCompiledStages(spec, malformed)).toThrow(SpatialCompatibilityError);
  });

  it("allows stored JSON object key reordering while preserving geometry arrays", () => {
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, nested]) => [key, reorder(nested)]));
      return value;
    };
    expect(readCompiledStages(spec, reorder(maps))).toEqual(maps);
  });
});
