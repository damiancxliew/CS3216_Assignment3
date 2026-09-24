import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { normalizeWalkingSpriteSheet } from '../src/assets/openai-images'

describe('walking sprite sheet normalization', () => {
  it('keeps sixteen distinct poses in their own 16px frames', async () => {
    const pixels = Buffer.alloc(128 * 128 * 4)
    for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) {
      for (let y = 9; y < 23; y += 1) for (let x = 9; x < 23; x += 1) {
        const at = ((row * 32 + y) * 128 + column * 32 + x) * 4
        pixels[at] = row * 50
        pixels[at + 1] = column * 50
        pixels[at + 3] = 255
      }
    }
    const input = await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer()
    const sheet = await normalizeWalkingSpriteSheet(input)
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height, info.channels]).toEqual([64, 64, 4])
    for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) {
      const at = ((row * 16 + 8) * 64 + column * 16 + 8) * 4
      expect([...data.subarray(at, at + 4)]).toEqual([row * 50, column * 50, 0, 255])
    }
  })

  it('rejects a sheet with a missing pose', async () => {
    const blank = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#00000000' } }).png().toBuffer()
    await expect(normalizeWalkingSpriteSheet(blank)).rejects.toThrow(/empty/)
  })
})
