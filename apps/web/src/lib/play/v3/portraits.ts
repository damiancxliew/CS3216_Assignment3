export function portraitUrl(
  portraitKey: string,
  env?: { NEXT_PUBLIC_V3_PORTRAIT_BASE?: string },
): string | null {
  const base = (env ? env.NEXT_PUBLIC_V3_PORTRAIT_BASE : process.env.NEXT_PUBLIC_V3_PORTRAIT_BASE)?.trim();
  if (!base) return null;
  try {
    return new URL(`${encodeURIComponent(portraitKey)}.png`, `${base.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}
