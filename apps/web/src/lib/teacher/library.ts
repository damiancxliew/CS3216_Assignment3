import type { SupabaseClient } from "@supabase/supabase-js";

type LibraryAdventure = { id: string; published_version: number | null };
export type LibraryVersion = { id: string; adventure_id: string; version: number; published_at: string | null };
export type LibraryAsset = { spec_version_id: string; asset_id: string; kind: string; status: string; url: string };
export type AdventureArtwork = { cover: { url: string; kind: "portrait" | "landmark" | "prop" } | null; portraits: string[] };

/** Match the editor's active version. Never borrow artwork from another story or an older draft. */
export function selectLibraryArtwork(adventure: LibraryAdventure, versions: LibraryVersion[], assets: LibraryAsset[]): AdventureArtwork {
  const candidates = versions.filter((version) => version.adventure_id === adventure.id).sort((a, b) => b.version - a.version);
  const shown = candidates.find((version) => version.published_at === null)
    ?? candidates.find((version) => version.version === adventure.published_version);
  const ready = assets.filter((asset) => asset.spec_version_id === shown?.id && (asset.status === "ready" || asset.status === "cached") && asset.url)
    .sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  const portraits = [...new Set(ready.filter((asset) => asset.kind === "portrait").map((asset) => asset.url))];
  const chosen = ready.find((asset) => asset.kind === "portrait") ?? ready.find((asset) => asset.kind === "landmark") ?? ready.find((asset) => asset.kind === "prop") ?? null;
  const cover = chosen ? { url: chosen.url, kind: chosen.kind as "portrait" | "landmark" | "prop" } : null;
  return { cover, portraits: portraits.filter((url) => url !== cover?.url).slice(0, 3) };
}

/** Batched, public metadata only; caller supplies adventures already filtered to the signed-in owner. */
export async function loadLibraryArtwork(supabase: SupabaseClient, adventures: LibraryAdventure[]) {
  const artwork = new Map<string, AdventureArtwork>();
  if (!adventures.length) return artwork;
  const { data: versions } = await supabase.from("spec_version")
    .select("id, adventure_id, version, published_at").in("adventure_id", adventures.map((adventure) => adventure.id))
    .returns<LibraryVersion[]>();
  if (!versions?.length) return artwork;
  const { data: assets } = await supabase.from("asset")
    .select("spec_version_id, asset_id, kind, status, url").in("spec_version_id", versions.map((version) => version.id))
    .in("status", ["ready", "cached"]).returns<LibraryAsset[]>();
  for (const adventure of adventures) artwork.set(adventure.id, selectLibraryArtwork(adventure, versions, assets ?? []));
  return artwork;
}
