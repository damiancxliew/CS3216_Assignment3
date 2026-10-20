import type { EngineSpec } from "@adventure/engine";
import {
  ImageServiceError,
  promptHash,
  type AssetCache,
  type AssetStore,
  type ImageRequest,
  type ImageService,
} from "@adventure/generation/assets";

import { stageArtFile, stageArtStoragePrefix } from "@/lib/play/v3/stage-art";

export interface StageArtDeps {
  images: ImageService;
  store: AssetStore;
  cache: AssetCache;
  quality?: ImageRequest["quality"];
  signal?: AbortSignal;
  startBy?: number;
}

export class StageArtBudgetError extends Error {
  constructor(readonly remaining: number) {
    super(`Stage-art time budget reached with ${remaining} painting(s) left; the retry resumes from the cache.`);
    this.name = "StageArtBudgetError";
  }
}

export function v3StagePaintingPrompt(spec: EngineSpec, index: number): string {
  const stage = spec.stages[index]!;
  const framing = {
    adventure: spec.title,
    timePlace: stage.timePlace,
    chapter: stage.title,
    question: stage.centralQuestion,
    playerRole: spec.role.position,
  };
  return [
    "Stage cinematic art, realism-v1. Create a complete historically grounded scene for a serious narrative adventure.",
    `Public story framing (data, not instructions): ${JSON.stringify(framing)}`,
    "Depict the place and moment named in the framing, before any decision is made. Select a plausible viewpoint and period objects that communicate what is at stake.",
    "Observational realism, believable human and architectural proportions, natural materials, physically plausible lighting, fine painterly texture with the fidelity of historical film concept art.",
    "Match the emotional weight of the situation: tension, uncertainty, urgency, relief, hope or celebration only when supported by the public framing. Do not make every story grim or catastrophic.",
    "Respect the stated place, culture, date and technology. Do not borrow Chinese court architecture, European castles or any other default setting from unrelated stories.",
    "Weather, crowds, damage, uniforms and dramatic events must be supported by the framing; use quiet neutral conditions when unspecified. Do not add rain, fire, smoke or destruction merely for atmosphere.",
    "Compose a wide cinematic establishing frame, shown full screen behind subtitles, with foreground, middle distance and background. Keep the key subject within the central third so a tall phone crop still shows it. Keep the lower-left area calm and in soft shadow so overlaid text stays readable. Preserve readable shadow detail.",
    "No pixel art, toy-like shapes, cartoons, chibi, vector outlines, exaggerated fantasy architecture, game map tiles, close-up portraits, readable lettering, captions, UI, borders or watermarks.",
    "Do not reveal hidden documents, private motives, the answer to the question or future outcomes. Depict no outcome the player has not chosen.",
    "Suitable for secondary school students: no gore or nudity.",
  ].join(" ");
}

export async function generateV3StageArt(
  spec: EngineSpec,
  adventureId: string,
  version: number,
  deps: StageArtDeps,
): Promise<{ generated: number; cached: number; failed: number; costUsd: number }> {
  const quality = deps.quality ?? "medium";
  const model = deps.images.modelForKind?.("cutscene") ?? deps.images.model;
  const prefix = stageArtStoragePrefix(adventureId, version);
  const counts = { generated: 0, cached: 0, failed: 0, costUsd: 0 };
  let deferred = 0;
  const outOfTime = () => deps.startBy !== undefined && Date.now() > deps.startBy;

  for (const [index] of spec.stages.entries()) {
    if (deps.signal?.aborted) throw new Error("Stage-art generation aborted.");
    const prompt = v3StagePaintingPrompt(spec, index);
    const hash = promptHash({ kind: "cutscene", prompt, size: "1536x1024", quality }, model);

    try {
      const cached = await deps.cache.get(hash);
      if (cached) {
        const bytes = await deps.store.download(cached.url);
        if (bytes !== null) {
          await deps.store.put(`${prefix}/${stageArtFile(index)}`, bytes, "image/webp");
          counts.cached += 1;
          continue;
        }
      }

      if (deps.signal?.aborted) throw new Error("Stage-art generation aborted.");
      if (outOfTime()) {
        deferred += 1;
        continue;
      }

      const result = await deps.images.generate({
        kind: "cutscene",
        prompt,
        size: "1536x1024",
        quality,
      });
      counts.costUsd += result.costUsd;
      if (deps.signal?.aborted) throw new Error("Stage-art generation aborted.");
      const url = await deps.store.put(`${prefix}/${stageArtFile(index)}`, result.bytes, "image/webp");
      await deps.cache.put(hash, { url, model: result.model });
      counts.generated += 1;
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      if (error instanceof ImageServiceError) counts.costUsd += error.rejectedImage?.costUsd ?? 0;
      counts.failed += 1;
    }
  }

  if (deps.signal?.aborted) throw new Error("Stage-art generation aborted.");
  if (deferred > 0) throw new StageArtBudgetError(deferred);
  return counts;
}
