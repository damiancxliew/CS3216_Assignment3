/**
 * The generation asset service (D5/D6) over the platform: image bytes go to the
 * public `assets` bucket, the prompt-hash cache and the per-version manifest
 * live in `asset_cache` / `asset`. Everything here runs with the service role
 * after publish; clients only ever read `asset` rows through RLS.
 */
import type { AssetCache, AssetManifest, AssetRecord, AssetStore } from "@adventure/generation/assets";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "assets";

export class SupabaseAssetStore implements AssetStore {
  constructor(private readonly admin: SupabaseClient) {}

  async put(key: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    const { error } = await this.admin.storage.from(BUCKET).upload(key, bytes, { contentType: mimeType, upsert: true });
    if (error) throw new Error(`asset upload failed: ${error.message}`);
    return this.admin.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
  }
}

export class SupabaseAssetCache implements AssetCache {
  constructor(private readonly admin: SupabaseClient) {}

  async get(promptHash: string): Promise<{ url: string; model: string } | null> {
    const { data } = await this.admin.from("asset_cache").select("url, model").eq("prompt_hash", promptHash).maybeSingle<{ url: string; model: string }>();
    return data ?? null;
  }

  async put(promptHash: string, value: { url: string; model: string }): Promise<void> {
    const { error } = await this.admin.from("asset_cache").upsert({ prompt_hash: promptHash, ...value }, { onConflict: "prompt_hash" });
    if (error) throw new Error(`asset_cache: ${error.message}`);
  }
}

type AssetRow = {
  asset_id: string;
  entity_id: string;
  kind: AssetRecord["kind"];
  status: AssetRecord["status"];
  url: string;
  placeholder_url: string;
  prompt_hash: string;
  model: string | null;
  cost_usd: number | string;
  error: string | null;
};

/** Write (or update) one record of a version's manifest. Called as each image settles, so progress is visible. */
export async function saveAssetRecord(admin: SupabaseClient, specVersionId: string, record: AssetRecord): Promise<void> {
  const { error } = await admin.from("asset").upsert(
    {
      spec_version_id: specVersionId,
      asset_id: record.assetId,
      entity_id: record.entityId,
      kind: record.kind,
      status: record.status,
      url: record.url,
      placeholder_url: record.placeholderUrl,
      prompt_hash: record.promptHash,
      model: record.model,
      cost_usd: record.costUsd,
      error: record.error,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "spec_version_id,asset_id" },
  );
  if (error) throw new Error(`asset: ${error.message}`);
}

export async function saveManifest(admin: SupabaseClient, specVersionId: string, manifest: AssetManifest): Promise<void> {
  for (const record of manifest.records) await saveAssetRecord(admin, specVersionId, record);
}

/** The manifest as stored; `null` when generation never ran for this version. */
export async function loadManifest(admin: SupabaseClient, specVersionId: string, adventureId: string, specVersion: number): Promise<AssetManifest | null> {
  const { data } = await admin.from("asset").select("asset_id, entity_id, kind, status, url, placeholder_url, prompt_hash, model, cost_usd, error").eq("spec_version_id", specVersionId).returns<AssetRow[]>();
  if (!data || data.length === 0) return null;
  const records: AssetRecord[] = data.map((row) => ({
    assetId: row.asset_id,
    entityId: row.entity_id,
    kind: row.kind,
    status: row.status,
    url: row.url,
    placeholderUrl: row.placeholder_url,
    promptHash: row.prompt_hash,
    model: row.model,
    costUsd: Number(row.cost_usd),
    error: row.error,
  }));
  return {
    adventureId,
    specVersion,
    records,
    generatedCount: records.filter((r) => r.status === "ready").length,
    cacheHits: records.filter((r) => r.status === "cached").length,
    totalCostUsd: records.reduce((sum, r) => sum + r.costUsd, 0),
    startedAt: "",
    finishedAt: records.every((r) => r.status !== "pending") ? "" : null,
  };
}
