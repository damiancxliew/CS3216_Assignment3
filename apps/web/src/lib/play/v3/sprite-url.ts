const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const mediaPath = new RegExp(`^(${uuid})/(${uuid})/([0-9a-f]{64}\\.(png|webp))$`, "i");

/** Only immutable image objects created by the media service are public sprite paths. */
export function spriteObjectKey(path: string): string | null {
  return mediaPath.test(path) ? `v3/media/${path}` : null;
}

/** Phaser uses XHR/WebGL: unlike an <img>, it requires CORS for external images. */
export function spritePresentationUrl(url: string, assetBase = process.env.ASSET_BUCKET ? process.env.ASSET_PUBLIC_BASE_URL : undefined): string {
  if (!assetBase) return url;
  const prefix = `${assetBase.replace(/\/+$/, "")}/v3/media/`;
  if (!url.startsWith(prefix)) return url;
  const path = url.slice(prefix.length);
  return spriteObjectKey(path) ? `/api/v3/sprites/${path}` : url;
}
