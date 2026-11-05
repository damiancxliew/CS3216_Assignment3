import sharp, { type Metadata } from "sharp";
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export type NormalizedMedia = {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: "webp" | "png";
};
function checkSize(bytes: Uint8Array) {
  if (!bytes.length) throw Error("Choose a nonempty image.");
  if (bytes.length > MAX_MEDIA_BYTES)
    throw Error("Images must be 10 MB or smaller.");
}
export async function normalizeImageUpload(
  bytes: Uint8Array,
): Promise<NormalizedMedia> {
  checkSize(bytes);
  try {
    const source = sharp(bytes, {
      limitInputPixels: 40_000_000,
      animated: true,
      failOn: "warning",
    });
    const metadata = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) !== 1
    )
      throw Error("Use a static JPEG, PNG or WebP image.");
    const result = await source
      .rotate()
      .resize({
        width: 2560,
        height: 2560,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: new Uint8Array(result.data),
      width: result.info.width,
      height: result.info.height,
      format: "webp",
    };
  } catch (cause) {
    if (cause instanceof Error && /Use a static/.test(cause.message))
      throw cause;
    throw Error(
      "Could not decode the image. Use JPEG, PNG or WebP with at most 40 megapixels.",
    );
  }
}
/** This path never rotates, crops or resizes: cell positions are the renderer contract. */
export async function validateSpriteUpload(
  bytes: Uint8Array,
): Promise<NormalizedMedia> {
  checkSize(bytes);
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: 2048 * 2048,
      animated: true,
    }).metadata();
  } catch {
    throw Error(
      "Could not decode the sheet. Use a static PNG or WebP up to 2048 × 2048.",
    );
  }
  if (
    !["png", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) !== 1
  )
    throw Error("Use one static PNG or WebP sheet, not an animated file.");
  const { width, height } = metadata;
  if (
    !width ||
    !height ||
    width !== height ||
    width < 64 ||
    width > 2048 ||
    width % 4
  )
    throw Error(
      "The sheet must be square, 64–2048 pixels per side, and divisible by four (a 4 × 4 grid).",
    );
  if (!metadata.hasAlpha)
    throw Error(
      "The sheet needs an alpha channel and transparent background pixels in every cell.",
    );
  const { data, info } = await sharp(bytes, { limitInputPixels: 2048 * 2048 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cell = width / 4;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      let visible = false,
        transparent = false;
      for (let y = row * cell; y < (row + 1) * cell; y++)
        for (let x = col * cell; x < (col + 1) * cell; x++) {
          const alpha = data[(y * width + x) * info.channels + 3]!;
          visible ||= alpha > 32;
          transparent ||= alpha === 0;
        }
      if (!visible)
        throw Error(
          `Cell ${row + 1},${col + 1} has no visible character. Fill every cell.`,
        );
      if (!transparent)
        throw Error(
          `Cell ${row + 1},${col + 1} needs transparent background pixels.`,
        );
    }
  const result = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return { bytes: new Uint8Array(result), width, height, format: "png" };
}
