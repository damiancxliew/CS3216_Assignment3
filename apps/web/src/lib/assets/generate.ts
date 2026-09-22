/**
 * D5/D6 -> P4: generate a published version's story-specific images after the
 * publish has already succeeded. Publish never waits on this (FR-6a): the
 * manifest is written all-`pending` first, then each record is updated as its
 * image settles, so the play view shows placeholders and swaps them in.
 *
 * Only the kinds the spec marks eligible are requested (portrait, landmark,
 * prop); the service refuses anything else and caps at 8 per adventure (D5).
 */
import { generateAssets, pendingManifest, type ImageService } from "@adventure/generation/assets";
import { validatePublishedSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import { saveAssetRecord, saveManifest, SupabaseAssetCache, SupabaseAssetStore } from "./supabase";

export interface GenerateForVersionOptions {
  admin: SupabaseClient;
  images: ImageService;
  adventureId: string;
  version: number;
  quality?: "low" | "medium" | "high";
}

export type GenerateForVersionResult =
  | { ok: true; specVersionId: string; generated: number; cached: number; failed: number; costUsd: number }
  | { ok: false; reason: string };

export async function generateAssetsForVersion(options: GenerateForVersionOptions): Promise<GenerateForVersionResult> {
  const { data: version } = await options.admin
    .from("spec_version")
    .select("id, json")
    .eq("adventure_id", options.adventureId)
    .eq("version", options.version)
    .maybeSingle<{ id: string; json: unknown }>();
  if (!version) return { ok: false, reason: "no such published version" };
  const validated = validatePublishedSpec(version.json);
  if (!validated.ok) return { ok: false, reason: "stored spec does not validate" };
  const spec = validated.spec;
  if (spec.assetEligibility.length === 0) return { ok: true, specVersionId: version.id, generated: 0, cached: 0, failed: 0, costUsd: 0 };

  const quality = options.quality ?? "low";
  const manifest = pendingManifest(spec, options.images, quality);
  await saveManifest(options.admin, version.id, manifest);

  const settled = await generateAssets(
    spec,
    {
      images: options.images,
      cache: new SupabaseAssetCache(options.admin),
      store: new SupabaseAssetStore(options.admin),
      quality,
      onRecord: (record) => void saveAssetRecord(options.admin, version.id, record).catch((error) => console.error("asset record not saved", error)),
    },
    manifest,
  );
  // The `onRecord` writes are fire-and-forget; one final pass makes the stored manifest authoritative.
  await saveManifest(options.admin, version.id, settled);

  return {
    ok: true,
    specVersionId: version.id,
    generated: settled.records.filter((r) => r.status === "ready").length,
    cached: settled.cacheHits,
    failed: settled.records.filter((r) => r.status === "failed" || r.status === "filtered").length,
    costUsd: settled.totalCostUsd,
  };
}
