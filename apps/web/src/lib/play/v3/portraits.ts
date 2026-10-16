export function portraitFile(portraitKey: string): string {
  return `${portraitKey.replace(/[^A-Za-z0-9_-]/g, "_")}.webp`;
}

export function portraitStoragePrefix(adventureId: string, version: number): string {
  return `v3/portraits/${adventureId}/v${version}`;
}

export function v3PortraitBase(
  adventureId: string,
  version: number,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  const base = supabaseUrl?.trim().replace(/\/+$/, "");
  return base
    ? `${base}/storage/v1/object/public/assets/${portraitStoragePrefix(adventureId, version)}`
    : null;
}

export function portraitUrl(portraitKey: string, base: string | null): string | null {
  return base ? `${base.replace(/\/+$/, "")}/${portraitFile(portraitKey)}` : null;
}
