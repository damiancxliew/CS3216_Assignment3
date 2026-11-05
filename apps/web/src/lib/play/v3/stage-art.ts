export function stageArtStoragePrefix(adventureId: string, version: number): string {
  return `v3/stage-art/${adventureId}/v${version}`;
}

export function stageArtFile(index: number): string {
  return `stage-${index}.webp`;
}

export function v3StageArtBase(
  adventureId: string,
  version: number,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  assetPublicBase = process.env.ASSET_BUCKET ? process.env.ASSET_PUBLIC_BASE_URL : undefined,
): string | null {
  const prefix = stageArtStoragePrefix(adventureId, version);
  const s3 = assetPublicBase?.trim().replace(/\/+$/, "");
  if (s3) return `${s3}/${prefix}`;
  const base = supabaseUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/storage/v1/object/public/assets/${prefix}` : null;
}

export function stageArtUrl(base: string | null, index: number): string | null {
  return base ? `${base.replace(/\/+$/, "")}/${stageArtFile(index)}` : null;
}
