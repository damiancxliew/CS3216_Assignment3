import { defineStep, type EnqueueStep } from "@adventure/jobs";
import { EngineSpec } from "@adventure/engine";
import { OpenAiImageService } from "@adventure/generation/assets";

import { SupabaseAssetCache, SupabaseAssetStore } from "@/lib/assets/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateStancePortraits } from "@/lib/v3/portraits/generate";

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
    if (!data) throw new Error(`Missing v3 adventure version ${input.adventureId}:${input.version}`);

    const spec = EngineSpec.parse(data.spec);
    return generateStancePortraits(spec, input.adventureId, input.version, {
      images: new OpenAiImageService(),
      store: new SupabaseAssetStore(admin),
      cache: new SupabaseAssetCache(admin),
      signal,
    });
  },
  { maxAttempts: 2 },
);

export const jobSteps = [stancePortraitStep];

export function portraitsStep(adventureId: string, version: number): EnqueueStep {
  return {
    name: `portraits-v${version}`,
    step: "v3.portraits",
    input: { adventureId, version },
  };
}
