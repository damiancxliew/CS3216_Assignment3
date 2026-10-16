import type { EngineSpec } from "@adventure/engine";
import {
  buildPortraitSafetyRetryPrompt,
  ImageServiceError,
  promptHash,
  type AssetCache,
  type AssetStore,
  type ImageRequest,
  type ImageService,
} from "@adventure/generation/assets";

import { portraitFile, portraitStoragePrefix } from "@/lib/play/v3/portraits";

const PORTRAIT_STYLE =
  "Serious, historically grounded head-and-shoulders portrait, painterly, period-accurate dress, plain dark background, no text, borders, or watermarks.";

export interface StancePortraitDeps {
  images: ImageService;
  store: AssetStore;
  cache: AssetCache;
  quality?: ImageRequest["quality"];
  signal?: AbortSignal;
  /**
   * Epoch ms after which no new image call starts. A call can take up to two image timeouts, so the step stops
   * starting calls early enough to finish inside the host's 300 s limit, then fails so the retry resumes from
   * the cache instead of being killed mid-call.
   */
  startBy?: number;
}

export class PortraitBudgetError extends Error {
  constructor(readonly remaining: number) {
    super(`Portrait time budget reached with ${remaining} portrait(s) left; the retry resumes from the cache.`);
    this.name = "PortraitBudgetError";
  }
}

export function stancePortraitRequests(
  spec: EngineSpec,
): { portraitKey: string; prompt: string }[] {
  const setting = `${spec.title}; ${spec.stages[0]!.timePlace}`;

  return spec.characters.flatMap((character) => {
    const identity = [
      PORTRAIT_STYLE,
      `Identity: ${character.name}, ${character.title}.`,
      `Setting: ${setting}.`,
      `Persona voice: ${character.persona.voice}`,
      "Keep the face, clothing, framing and background identical across this character's portraits.",
    ].join("\n");
    const stances = character.tier === "major" ? character.stances : [null];

    return stances.map((stance) => ({
      portraitKey: stance ? `${character.id}:${stance.id}` : character.id,
      prompt: [
        identity,
        `Expression and posture: ${stance?.demeanour ?? "calm, neutral expression"}`,
      ].join("\n"),
    }));
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Portrait generation aborted.");
}

export async function generateStancePortraits(
  spec: EngineSpec,
  adventureId: string,
  version: number,
  deps: StancePortraitDeps,
): Promise<{ generated: number; cached: number; failed: number; costUsd: number }> {
  const requests = stancePortraitRequests(spec);
  const quality = deps.quality ?? "low";
  const model = deps.images.modelForKind?.("portrait") ?? deps.images.model;
  const prefix = portraitStoragePrefix(adventureId, version);
  const counts = { generated: 0, cached: 0, failed: 0, costUsd: 0 };
  let nextIndex = 0;
  let deferred = 0;
  const outOfTime = () => deps.startBy !== undefined && Date.now() > deps.startBy;

  async function generateOne(request: { portraitKey: string; prompt: string }): Promise<void> {
    throwIfAborted(deps.signal);
    const hash = promptHash({
      kind: "portrait",
      prompt: request.prompt,
      size: "1024x1024",
      quality,
    }, model);

    try {
      const cached = await deps.cache.get(hash);
      if (cached) {
        const bytes = await deps.store.download(cached.url);
        if (bytes !== null) {
          await deps.store.put(`${prefix}/${portraitFile(request.portraitKey)}`, bytes, "image/webp");
          counts.cached += 1;
          return;
        }
      }

      const imageRequest: ImageRequest = {
        kind: "portrait",
        prompt: request.prompt,
        size: "1024x1024",
        quality,
      };
      throwIfAborted(deps.signal);
      if (outOfTime()) {
        deferred += 1;
        return;
      }
      let result;
      try {
        result = await deps.images.generate(imageRequest);
      } catch (error) {
        if (!(error instanceof ImageServiceError) || error.code !== "content-filtered") throw error;
        counts.costUsd += error.rejectedImage?.costUsd ?? 0;
        throwIfAborted(deps.signal);
        if (outOfTime()) {
          deferred += 1;
          return;
        }
        result = await deps.images.generate({
          ...imageRequest,
          prompt: buildPortraitSafetyRetryPrompt(request.prompt),
        });
      }

      counts.costUsd += result.costUsd;
      const url = await deps.store.put(`${prefix}/${portraitFile(request.portraitKey)}`, result.bytes, "image/webp");
      await deps.cache.put(hash, { url, model: result.model });
      counts.generated += 1;
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      if (error instanceof ImageServiceError) {
        counts.costUsd += error.rejectedImage?.costUsd ?? 0;
      }
      counts.failed += 1;
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      throwIfAborted(deps.signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= requests.length) return;
      await generateOne(requests[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, requests.length) }, () => worker()));
  throwIfAborted(deps.signal);
  if (deferred > 0) throw new PortraitBudgetError(deferred);
  return counts;
}
