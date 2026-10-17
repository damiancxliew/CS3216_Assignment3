import { describe, expect, it } from "vitest";

import { checkSpec, validateSkeleton, validateSpec } from "@adventure/spec-v3";
import { quoteIssues, sourceTexts } from "@adventure/generation/v3";

import { fakeGenerationPasses, fakeOutsideSources, goldenSkeleton } from "@/lib/v3/generation/fake-passes";

const env = { V3_FAKE_PASSES: "1", NODE_ENV: "development" } as NodeJS.ProcessEnv;

describe("fake generation passes", () => {
  it("are off without the flag or in production", () => {
    expect(fakeGenerationPasses({} as NodeJS.ProcessEnv)).toBeNull();
    expect(fakeGenerationPasses({ V3_FAKE_PASSES: "1", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(fakeGenerationPasses(env)).not.toBeNull();
  });

  it("the projected skeleton validates and the spec validates with no checkSpec errors", async () => {
    const passes = fakeGenerationPasses(env)!;
    const skeletonResult = await passes.skeleton({} as never, {} as never);
    expect(skeletonResult.ok).toBe(true);
    if (!("skeleton" in skeletonResult)) return;
    expect(validateSkeleton(skeletonResult.skeleton).ok).toBe(true);

    const revealResult = await passes.reveal({} as never, {} as never);
    if (!("spec" in revealResult)) throw new Error("reveal returned no spec");
    expect(validateSpec(revealResult.spec).ok).toBe(true);
    expect(checkSpec(revealResult.spec).errors).toEqual([]);
  });

  it("goldenSkeleton itself validates", () => {
    const skeleton = goldenSkeleton(validateSpec(JSON.parse(require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../fixtures/golden-1819.json"), "utf8"))).spec);
    expect(validateSkeleton(skeleton).ok).toBe(true);
  });

  it("the fake outside documents contain every golden citation quote (approve's quote check passes)", async () => {
    const passes = fakeGenerationPasses(env)!;
    const result = await passes.sources({} as never, {} as never);
    const texts = sourceTexts(result.documents);
    const spec = validateSpec(JSON.parse(require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../fixtures/golden-1819.json"), "utf8"))).spec;
    const quotes = [
      ...spec.discoveries.flatMap((d, i) => (d.citations ?? []).flatMap((c, j) => (c.quote !== undefined ? [{ path: `discoveries.${i}.citations.${j}.quote`, sourceId: c.sourceId, quote: c.quote }] : []))),
      ...spec.endings.flatMap((e, i) => (e.citations ?? []).flatMap((c, j) => (c.quote !== undefined ? [{ path: `endings.${i}.citations.${j}.quote`, sourceId: c.sourceId, quote: c.quote }] : []))),
    ];
    expect(quotes.length).toBeGreaterThan(0);
    expect(quoteIssues(quotes, texts)).toEqual([]);

    // same shape directly from the helper
    const built = fakeOutsideSources(spec);
    expect(built.documents).toHaveLength(spec.sources.length);
    expect(sourceTexts(built.documents).size).toBe(spec.sources.length);
  });

  it("fail:<pass> makes that pass return ok:false", async () => {
    const passes = fakeGenerationPasses({ V3_FAKE_PASSES: "fail:skeleton", NODE_ENV: "development" } as NodeJS.ProcessEnv)!;
    const result = await passes.skeleton({} as never, {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("fake-failure");
  });
});
