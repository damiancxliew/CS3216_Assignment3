export const MAX_PREVIEW_BODY_BYTES = 2_000_000;

export function previewBodyTooLarge(text: string): boolean {
  return Buffer.byteLength(text, "utf8") > MAX_PREVIEW_BODY_BYTES;
}
