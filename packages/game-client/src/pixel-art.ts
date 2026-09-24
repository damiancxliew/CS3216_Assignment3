import type { MapThemeId } from './model.js'

/** Map fixture colors. Keeping a shared set of wood, stone and shadow tones ties
 * generated objects to the hand-drawn walls; accents follow the stage terrain. */
const BASE = [0x302820, 0x514033, 0x79553d, 0xa7734b, 0xc99761, 0xe2c79b, 0x6b6961, 0xa7a396]
const ACCENTS: Record<MapThemeId, readonly number[]> = {
  classic: [0x284733, 0x4a7441, 0x78a05a, 0xa4b56c, 0x6da4a2, 0xb24e3a, 0xe28b41, 0xf7c36c],
  desert: [0x725a3a, 0x9c7849, 0xc69a62, 0xe3bf7d, 0x7c7f69, 0xaa674b, 0xd48b54, 0xf1d59d],
  winter: [0x344954, 0x587583, 0x8da9b5, 0xc9d8e4, 0x607883, 0xaabed5, 0xd7ecf4, 0xf4f6ed],
  forest: [0x253d2d, 0x38683c, 0x5c9f56, 0x8fb36b, 0x61643d, 0x9b7961, 0xb1b97b, 0xd8c598],
  coast: [0x284b51, 0x3f7881, 0x6ba5a6, 0xa8c8b8, 0x69835d, 0xb7a288, 0xd3b484, 0xead3a1],
}

/** Quantize the model's downsampled image to opaque square pixels in the map palette. */
export function matchMapPalette(pixels: Uint8ClampedArray, theme: MapThemeId): void {
  const palette = [...BASE, ...ACCENTS[theme]]
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3]! < 128) {
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 0
      continue
    }
    let best = palette[0]!
    let distance = Infinity
    for (const color of palette) {
      const red = (color >> 16) & 255
      const green = (color >> 8) & 255
      const blue = color & 255
      const dr = pixels[offset]! - red
      const dg = pixels[offset + 1]! - green
      const db = pixels[offset + 2]! - blue
      const candidate = 2 * dr * dr + 3 * dg * dg + db * db
      if (candidate < distance) {
        distance = candidate
        best = color
      }
    }
    pixels[offset] = (best >> 16) & 255
    pixels[offset + 1] = (best >> 8) & 255
    pixels[offset + 2] = best & 255
    pixels[offset + 3] = 255
  }
}
