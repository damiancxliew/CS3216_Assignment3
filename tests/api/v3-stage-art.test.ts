import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { EngineSpec } from "@adventure/engine";
import {
  FakeImageService,
  InMemoryAssetCache,
  InMemoryAssetStore,
  promptHash,
} from "@adventure/generation/assets";

import { jobSteps, stageArtStep } from "@/lib/jobs/steps";
import { stageArtFile, stageArtStoragePrefix, stageArtUrl, v3StageArtBase } from "@/lib/play/v3/stage-art";
import { generateV3StageArt, StageArtBudgetError, v3StagePaintingPrompt } from "@/lib/v3/stage-art/generate";

const spec = EngineSpec.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/golden-1819.json"), "utf8")));
const adventureId = "adventure-stage-art";

describe("v3 stage-art paths", () => {
  it("builds stage filenames and Supabase/S3 public bases", () => {
    expect(stageArtStoragePrefix(adventureId, 4)).toBe("v3/stage-art/adventure-stage-art/v4");
    expect(stageArtFile(1)).toBe("stage-1.webp");
    expect(v3StageArtBase(adventureId, 4, "https://supabase.example.test/")).toBe(
      "https://supabase.example.test/storage/v1/object/public/assets/v3/stage-art/adventure-stage-art/v4",
    );
    expect(v3StageArtBase(adventureId, 4, "", "https://cdn.example.test/")).toBe(
      "https://cdn.example.test/v3/stage-art/adventure-stage-art/v4",
    );
    expect(v3StageArtBase(adventureId, 4, "")).toBeNull();
    expect(stageArtUrl("https://cdn.example.test/base/", 0)).toBe("https://cdn.example.test/base/stage-0.webp");
    expect(stageArtUrl(null, 0)).toBeNull();
  });

  it("describes only the public story framing and historical art direction", () => {
    const prompt = v3StagePaintingPrompt(spec, 0);
    const stage = spec.stages[0]!;
    expect(prompt).toContain(stage.timePlace);
    expect(prompt).toContain(stage.title);
    expect(prompt).toContain(stage.centralQuestion);
    expect(prompt).toContain(spec.role.position);
      expect(prompt).not.toContain(spec.discoveries[0]!.text);
    expect(prompt).not.toContain("privateAgenda");
    expect(prompt).not.toContain(spec.definingMoments[0]?.outcomes[0]?.summary ?? "unused-outcome");
    expect(prompt).toContain("Observational realism, believable human and architectural proportions");
    expect(prompt).toContain("Match the emotional weight of the situation");
    expect(prompt).toContain("Respect the stated place, culture, date and technology");
    expect(prompt).toContain("Weather, crowds, damage, uniforms");
    expect(prompt).toContain("Compose a wide cinematic establishing frame");
    expect(prompt).toContain("No pixel art, toy-like shapes");
  });

  it("registers the versioned stage-art job", () => {
    expect(stageArtStep(adventureId, 4)).toEqual({
      name: "stage-art-v4",
      step: "v3.stage-art",
      input: { adventureId, version: 4 },
    });
    expect(jobSteps.some((step) => step.name === "v3.stage-art")).toBe(true);
  });
});

describe("v3 stage-art generation", () => {
  it("copies cached paintings to the new version without image requests", async () => {
    const oneStageSpec = { ...spec, stages: spec.stages.slice(0, 1) };
    const images = new FakeImageService();
    const store = new InMemoryAssetStore();
    const cache = new InMemoryAssetCache();
    const bytes = new TextEncoder().encode("cached painting");
    const cachedUrl = await store.put("cache/stage.webp", bytes, "image/webp");
    const prompt = v3StagePaintingPrompt(oneStageSpec, 0);
    const hash = promptHash({ kind: "cutscene", prompt, size: "1536x1024", quality: "medium" }, images.model);
    await cache.put(hash, { url: cachedUrl, model: images.model });

    const result = await generateV3StageArt(oneStageSpec, adventureId, 2, { images, store, cache });

    expect(result).toEqual({ generated: 0, cached: 1, failed: 0, costUsd: 0 });
    expect(images.requests).toHaveLength(0);
    expect(store.objects.get(`${stageArtStoragePrefix(adventureId, 2)}/stage-0.webp`)?.bytes).toEqual(bytes);
  });

  it("counts a failed painting and continues with later stages", async () => {
    const images = new FakeImageService(["fail", "ok"]);
    const result = await generateV3StageArt(spec, adventureId, 1, {
      images,
      store: new InMemoryAssetStore(),
      cache: new InMemoryAssetCache(),
    });

    expect(result).toMatchObject({
      generated: spec.stages.length - 1,
      cached: 0,
      failed: 1,
      costUsd: 0.011 * (spec.stages.length - 1),
    });
    expect(images.requests).toHaveLength(spec.stages.length);
    expect(images.requests[0]).toMatchObject({
      kind: "cutscene",
      size: "1536x1024",
      quality: "medium",
    });
  });

  it("stops starting image calls when the budget expires", async () => {
    const images = new FakeImageService();
    const generation = generateV3StageArt(spec, adventureId, 1, {
      images,
      store: new InMemoryAssetStore(),
      cache: new InMemoryAssetCache(),
      startBy: 0,
    });
    await expect(generation).rejects.toBeInstanceOf(StageArtBudgetError);
    await expect(generation).rejects.toMatchObject({ remaining: spec.stages.length });
    expect(images.requests).toHaveLength(0);
  });
});
