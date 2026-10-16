import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { EngineSpec } from "@adventure/engine";
import {
  FakeImageService,
  ImageServiceError,
  InMemoryAssetCache,
  InMemoryAssetStore,
  buildPortraitSafetyRetryPrompt,
  type ImageRequest,
  type ImageResult,
  type ImageService,
} from "@adventure/generation/assets";

import { jobSteps, portraitsStep } from "@/lib/jobs/steps";
import { generateStancePortraits, stancePortraitRequests } from "@/lib/v3/portraits/generate";
import {
  portraitFile,
  portraitStoragePrefix,
  portraitUrl,
  v3PortraitBase,
} from "@/lib/play/v3/portraits";

const spec = EngineSpec.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/golden-1819.json"), "utf8")));
const adventureId = "adventure-portraits";

describe("portrait helpers", () => {
  it("builds sanitized filenames and adventure-version public URLs", () => {
    expect(portraitFile("raffles:r1")).toBe("raffles_r1.webp");
    expect(portraitStoragePrefix(adventureId, 3)).toBe("v3/portraits/adventure-portraits/v3");
    expect(v3PortraitBase(adventureId, 3, "https://supabase.example.test/"))
      .toBe("https://supabase.example.test/storage/v1/object/public/assets/v3/portraits/adventure-portraits/v3");
    expect(v3PortraitBase(adventureId, 3, "")).toBeNull();
    expect(portraitUrl("raffles:r1", null)).toBeNull();
  });
});

describe("stance portrait generation", () => {
  it("requests every major stance and one portrait for each minor character", () => {
    const requests = stancePortraitRequests(spec);

    expect(new Set(requests.map(({ portraitKey }) => portraitKey))).toEqual(new Set([
      "temenggong:t1",
      "temenggong:t2",
      "temenggong:t3",
      "temenggong:t4",
      "raffles:r1",
      "raffles:r2",
      "raffles:r3",
      "hussein:h1",
      "hussein:h2",
      "hussein:h3",
      "batin",
      "farquhar",
      "messenger",
    ]));

    for (const character of spec.characters) {
      const characterRequests = requests.filter(({ portraitKey }) =>
        portraitKey === character.id || portraitKey.startsWith(`${character.id}:`),
      );
      for (const request of characterRequests) {
        expect(request.prompt).toContain("Serious, historically grounded head-and-shoulders portrait");
        expect(request.prompt).toContain(`${character.name}, ${character.title}`);
        expect(request.prompt).toContain(`${spec.title}; ${spec.stages[0]!.timePlace}`);
        expect(request.prompt).toContain(character.persona.voice);
        expect(request.prompt).toContain("no text, borders, or watermarks.");
      }
    }

    for (const character of spec.characters) {
      const characterRequests = requests.filter(({ portraitKey }) => portraitKey.startsWith(`${character.id}:`));
      if (character.tier !== "major") continue;
      expect(characterRequests).toHaveLength(character.stances.length);
      for (const request of characterRequests) {
        const stance = character.stances.find((item) => request.portraitKey === `${character.id}:${item.id}`)!;
        expect(request.prompt).toContain(`Expression and posture: ${stance.demeanour}`);
        expect(request.prompt.split("\n")).not.toContain(`Stance label: ${stance.label}`);
      }
      const fixedPrompts = characterRequests.map(({ prompt }) =>
        prompt.replace(/^Expression and posture: .*$/m, "Expression and posture: <demeanour>"),
      );
      expect(new Set(fixedPrompts).size).toBe(1);
    }

    for (const character of spec.characters.filter((item) => item.tier === "minor")) {
      const request = requests.find(({ portraitKey }) => portraitKey === character.id)!;
      expect(request.prompt).toContain("Expression and posture: calm, neutral expression");
    }
  });

  it("generates portraits once, then restores cached images to the versioned paths", async () => {
    const images = new FakeImageService("ok", 0.011);
    const store = new InMemoryAssetStore();
    const cache = new InMemoryAssetCache();
    const requests = stancePortraitRequests(spec);
    const expectedKeys = requests
      .map(({ portraitKey }) => `${portraitStoragePrefix(adventureId, 1)}/${portraitFile(portraitKey)}`)
      .sort();

    const first = await generateStancePortraits(spec, adventureId, 1, { images, store, cache });
    expect(first).toMatchObject({ generated: requests.length, cached: 0, failed: 0 });
    expect(first.costUsd).toBeCloseTo(requests.length * images.costPerImage);
    expect([...store.objects.keys()].sort()).toEqual(expectedKeys);
    expect([...store.objects.values()].every(({ mimeType }) => mimeType === "image/webp")).toBe(true);

    const put = vi.spyOn(store, "put");
    put.mockClear();
    const second = await generateStancePortraits(spec, adventureId, 1, { images, store, cache });
    expect(second).toEqual({ generated: 0, cached: requests.length, failed: 0, costUsd: 0 });
    expect(images.requests).toHaveLength(requests.length);
    expect(put).toHaveBeenCalledTimes(requests.length);
    expect([...store.objects.keys()].sort()).toEqual(expectedKeys);
  });

  it("retries a content-filtered portrait once with the safety prompt", async () => {
    const images = new FakeImageService(["filter", "ok"]);
    const store = new InMemoryAssetStore();
    const requests = stancePortraitRequests(spec);

    const result = await generateStancePortraits(spec, adventureId, 1, {
      images,
      store,
      cache: new InMemoryAssetCache(),
    });

    expect(result).toMatchObject({ generated: requests.length, cached: 0, failed: 0 });
    expect(images.requests).toHaveLength(requests.length + 1);
    expect(images.requests.some(({ prompt }) =>
      requests.some(({ prompt: original }) => prompt === buildPortraitSafetyRetryPrompt(original)),
    )).toBe(true);
  });

  it("counts a portrait rejected twice as failed and continues with the other requests", async () => {
    const requests: ImageRequest[] = [];
    const images: ImageService = {
      model: "scripted-image-model",
      async generate(request): Promise<ImageResult> {
        requests.push(request);
        if (request.prompt.includes("Expression and posture: polite but closed")) {
          throw new ImageServiceError("content-filtered", "filtered");
        }
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/webp",
          model: "scripted-image-model",
          costUsd: 0.01,
        };
      },
    };

    const result = await generateStancePortraits(spec, adventureId, 1, {
      images,
      store: new InMemoryAssetStore(),
      cache: new InMemoryAssetCache(),
    });

    expect(result).toMatchObject({ generated: 12, cached: 0, failed: 1 });
    expect(requests.filter((request) => request.prompt.includes("Expression and posture: polite but closed"))).toHaveLength(2);
    expect(requests).toHaveLength(14);
  });

  it("throws without starting work when its signal is already aborted", async () => {
    const images = new FakeImageService();
    const controller = new AbortController();
    controller.abort();

    await expect(generateStancePortraits(spec, adventureId, 1, {
      images,
      store: new InMemoryAssetStore(),
      cache: new InMemoryAssetCache(),
      signal: controller.signal,
    })).rejects.toThrow("Portrait generation aborted.");
    expect(images.requests).toHaveLength(0);
  });

  it("limits concurrent requests to four", async () => {
    let active = 0;
    let maximum = 0;
    const images: ImageService = {
      model: "concurrency-test-model",
      async generate(): Promise<ImageResult> {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/webp",
          model: "concurrency-test-model",
          costUsd: 0,
        };
      },
    };

    const result = await generateStancePortraits(spec, adventureId, 1, {
      images,
      store: new InMemoryAssetStore(),
      cache: new InMemoryAssetCache(),
    });

    expect(maximum).toBe(4);
    expect(result.generated).toBe(stancePortraitRequests(spec).length);
  });

  it("stops starting image requests after the signal is aborted", async () => {
    const controller = new AbortController();
    let started = 0;
    const images: ImageService = {
      model: "abort-test-model",
      async generate(): Promise<ImageResult> {
        started += 1;
        controller.abort();
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/webp",
          model: "abort-test-model",
          costUsd: 0,
        };
      },
    };

    await expect(generateStancePortraits(spec, adventureId, 1, {
      images,
      store: new InMemoryAssetStore(),
      cache: new InMemoryAssetCache(),
      signal: controller.signal,
    })).rejects.toThrow("Portrait generation aborted.");
    expect(started).toBe(1);
  });

  it("registers the job step and returns its publish enqueue descriptor", () => {
    expect(jobSteps.map(({ name }) => name)).toContain("v3.portraits");
    expect(portraitsStep("adventure-1", 3)).toEqual({
      name: "portraits-v3",
      step: "v3.portraits",
      input: { adventureId: "adventure-1", version: 3 },
    });
  });
});
