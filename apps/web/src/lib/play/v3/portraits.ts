import type { MediaSnapshot } from "@adventure/spec-v3";
export function portraitFile(portraitKey: string): string {
  return `${portraitKey.replace(/[^A-Za-z0-9_-]/g, "_")}.webp`;
}

export function portraitStoragePrefix(
  adventureId: string,
  version: number,
): string {
  return `v3/portraits/${adventureId}/v${version}`;
}

/**
 * Where a version's portraits live: the S3/CloudFront base when assets go to S3 (`ASSET_BUCKET`, as
 * `createAssetStore` decides), otherwise Supabase Storage's public `assets` bucket.
 */
export function v3PortraitBase(
  adventureId: string,
  version: number,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  assetPublicBase = process.env.ASSET_BUCKET
    ? process.env.ASSET_PUBLIC_BASE_URL
    : undefined,
): string | null {
  const prefix = portraitStoragePrefix(adventureId, version);
  const s3 = assetPublicBase?.trim().replace(/\/+$/, "");
  if (s3) return `${s3}/${prefix}`;
  const base = supabaseUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/storage/v1/object/public/assets/${prefix}` : null;
}

export function portraitUrl(
  portraitKey: string,
  base: PortraitBase,
): string | null {
  if (
    base &&
    typeof base === "object" &&
    "selected" in base &&
    typeof base.selected === "object" &&
    base.selected !== null
  )
    return base.selected[portraitKey]?.url ?? null;
  if (base && typeof base === "object")
    base = (base as Record<string, string | null>)[portraitKey] ?? null;
  return base
    ? `${base.replace(/\/+$/, "")}/${portraitFile(portraitKey)}`
    : null;
}

export type PortraitPresentation = {
  url: string | null;
  metadata?: MediaSnapshot;
};
export type PortraitBase =
  | string
  | null
  | Record<string, string | null>
  | { selected: Record<string, PortraitPresentation> };
export function portraitMetadata(
  key: string,
  base: PortraitBase,
): MediaSnapshot | undefined {
  if (
    base &&
    typeof base === "object" &&
    "selected" in base &&
    typeof base.selected === "object" &&
    base.selected !== null
  )
    return base.selected[key]?.metadata;
}

export function versionedPortraitBase(
  adventureId: string,
  version: number,
  versions?: Record<string, number | null>,
): PortraitBase {
  if (!versions) return v3PortraitBase(adventureId, version);
  return Object.fromEntries(
    Object.entries(versions).map(([key, source]) => [
      key,
      source === null ? null : v3PortraitBase(adventureId, source),
    ]),
  );
}
