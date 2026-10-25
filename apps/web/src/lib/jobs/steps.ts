import { mediaGenerationStep } from "@/lib/v3/media/generate";
import { sourceRetryStep } from "@/lib/v3/sources/retry";
import { defineStep } from "@adventure/jobs";
import { EngineSpec } from "@adventure/engine";
import { OpenAiImageService } from "@adventure/generation/assets";

import { createAssetStore } from "@/lib/assets/store";
import { SupabaseAssetCache } from "@/lib/assets/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateStancePortraits } from "@/lib/v3/portraits/generate";
import { generateV3StageArt } from "@/lib/v3/stage-art/generate";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { v3GenerationSteps } from "@/lib/v3/generation/steps";

export { portraitsStep } from "@/lib/v3/portraits/step";
export { stageArtStep } from "@/lib/v3/stage-art/step";

const stancePortraitStep = defineStep<
  { adventureId: string; version: number },
  { generated: number; cached: number; failed: number; costUsd: number }
>(
  "v3.portraits",
  async ({ input, signal }) => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("adventure_versions_v3")
      .select("spec")
      .eq("adventure_id", input.adventureId)
      .eq("version", input.version)
      .maybeSingle<{ spec: unknown }>();
    if (error) throw error;
    if (!data) throw new Error(`Missing v3 adventure version ${input.adventureId}:${input.version}`,
      );

    const spec = EngineSpec.parse(data.spec);
    return generateStancePortraits(spec, input.adventureId, input.version, {
      // Two image calls of at most 60 s each fit between `startBy` and the step's abort at ~270 s.
      images: new OpenAiImageService({ timeoutMs: 60_000 }),
      store: createAssetStore(admin),
      cache: new SupabaseAssetCache(admin),
      signal,
      startBy: Date.now() + 120_000,
    });
  },
  // Each attempt resumes from the prompt-hash cache, so a large cast finishes over a few attempts.
  { maxAttempts: 6 },
);

const stageArtGeneratorStep = defineStep<
  { adventureId: string; version: number },
  { generated: number; cached: number; failed: number; costUsd: number }
>(
  "v3.stage-art",
  async ({ input, signal }) => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("adventure_versions_v3")
      .select("spec")
      .eq("adventure_id", input.adventureId)
      .eq("version", input.version)
      .maybeSingle<{ spec: unknown }>();
    if (error) throw error;
    if (!data)
      throw new Error(
        `Missing v3 adventure version ${input.adventureId}:${input.version}`,
      );

    const spec = EngineSpec.parse(data.spec);
    return generateV3StageArt(spec, input.adventureId, input.version, {
      images: new OpenAiImageService({ timeoutMs: 60_000 }),
      store: createAssetStore(admin),
      cache: new SupabaseAssetCache(admin),
      signal,
      startBy: Date.now() + 120_000,
    });
  },
  { maxAttempts: 4 },
);

export const jobSteps = [
  mediaGenerationStep,
  sourceRetryStep(defaultGenerationDeps),
  stancePortraitStep,
  stageArtGeneratorStep,
  ...v3GenerationSteps(defaultGenerationDeps),
];
