import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  normalizeImageUpload,
  validateSpriteUpload,
} from "@/lib/v3/media/uploads";
const sheet = async (opaque = false, blank = false) => {
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const at = (y * 64 + x) * 4;
      pixels[at] = 200;
      pixels[at + 3] =
        opaque ||
        (!blank && x % 16 > 4 && x % 16 < 12 && y % 16 > 2 && y % 16 < 14)
          ? 255
          : 0;
    }
  return sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
    .png()
    .toBuffer();
};
describe("media upload validation", () => {
  it("normalizes ordinary images without cropping and removes metadata", async () => {
    const bytes = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: "red" },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const result = await normalizeImageUpload(bytes);
    expect(result).toMatchObject({ width: 2560, height: 853, format: "webp" });
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });
  it("preserves every sprite cell and dimensions as lossless PNG", async () => {
    const bytes = await sheet();
    const result = await validateSpriteUpload(bytes);
    expect(result).toMatchObject({ width: 64, height: 64, format: "png" });
    expect(await sharp(result.bytes).raw().toBuffer()).toEqual(
      await sharp(bytes).raw().toBuffer(),
    );
  });
  it("rejects opaque or empty cells and ordinary portrait dimensions", async () => {
    await expect(validateSpriteUpload(await sheet(true))).rejects.toThrow(
      /transparent/,
    );
    await expect(
      validateSpriteUpload(await sheet(false, true)),
    ).rejects.toThrow(/visible/);
    const portrait = await sharp({
      create: { width: 300, height: 400, channels: 4, background: "#00000000" },
    })
      .png()
      .toBuffer();
    await expect(validateSpriteUpload(portrait)).rejects.toThrow(/square/);
  });
  it("rejects invalid bytes and files above 10 MB", async () => {
    await expect(
      normalizeImageUpload(new Uint8Array(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow(/10 MB/);
    await expect(
      normalizeImageUpload(new TextEncoder().encode("fake.png")),
    ).rejects.toThrow(/JPEG|decode/);
  });
});
