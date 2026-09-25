/**
 * D5/D6 -> P4: generate a version's story-specific images after the
 * publish has already succeeded. Publish never waits on this (FR-6a): the
 * manifest is written all-`pending` first, then each record is updated as its
 * image settles, so the play view shows placeholders and swaps them in.
 *
 * Portraits and props follow the spec's eligibility list. Every physical
 * landmark is eligible, including fixtures omitted by older specs; rooms with
 * no landmark are skipped. No fixed adventure-wide count limit applies.
 */
import { generateAssets, pendingManifest, playableAssetEligibility, type ImageService, type SceneAnnotator } from "@adventure/generation/assets";
import { validatePublishedSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import { saveAssetRecord, saveManifest, SupabaseAssetCache, SupabaseAssetStore } from "./supabase";

export interface GenerateForVersionOptions {
  admin: SupabaseClient;
  images: ImageService;
  /** Reads each stage opening for its animation and soundscape. */
  annotator?: SceneAnnotator;
  adventureId: string;
  version: number;
  quality?: "low" | "medium" | "high";
  /** Restrict the run to these `assetEligibility` ids (a single-asset regenerate); other rows are left untouched. */
  onlyAssetIds?: readonly string[];
  /** Skip the prompt-hash cache read so the image is forced to re-draw. */
  ignoreCache?: boolean;
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
  // A filtered eligibility list yields a manifest holding only those records,
  // so `saveManifest` below can never wipe the rows this run didn't touch. The
  // stored spec object is never mutated.
  const spec = { ...validated.spec, assetEligibility: playableAssetEligibility(validated.spec).filter((asset) =>
    !options.onlyAssetIds || options.onlyAssetIds.includes(asset.id),
  ) };
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
      ignoreCache: options.ignoreCache,
      annotator: options.annotator,
      onRecord: (record) => saveAssetRecord(options.admin, version.id, record).catch((error) => console.error("asset record not saved", error)),
    },
    manifest,
  );
  // One final pass makes the stored manifest authoritative.
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
