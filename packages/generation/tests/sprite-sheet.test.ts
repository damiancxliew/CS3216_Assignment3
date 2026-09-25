import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { normalizeWalkingSpriteSheet } from '../src/assets/openai-images'
import { WALKING_SHEET_REFERENCE } from '../src/assets/sprite-reference'

describe('walking sprite sheet normalization', () => {
  it('keeps sixteen distinct poses in their own 16px frames', async () => {
    const original = Buffer.from(WALKING_SHEET_REFERENCE, 'base64')
    const input = await sharp(original).resize(128, 128, { kernel: 'nearest' }).png().toBuffer()
    const sheet = await normalizeWalkingSpriteSheet(input)
    const { info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height, info.channels]).toEqual([64, 64, 4])
    expect(await sharp(sheet).raw().toBuffer()).toEqual(await sharp(original).ensureAlpha().raw().toBuffer())
  })

  it('rejects a sheet with a missing pose', async () => {
    const blank = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#00000000' } }).png().toBuffer()
    await expect(normalizeWalkingSpriteSheet(blank)).rejects.toThrow(/empty/)
  })

  it('rejects directions arranged as rows, which makes the walker turn every frame', async () => {
    const pixels = Buffer.alloc(64 * 64 * 4)
    for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) {
      for (let y = 2; y < 14; y += 1) for (let x = 3; x < 13; x += 1) {
        const at = ((row * 16 + y) * 64 + column * 16 + x) * 4
        pixels[at] = row * 60
        pixels[at + 3] = 255
      }
    }
    const input = await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()
    await expect(normalizeWalkingSpriteSheet(input)).rejects.toThrow(/pose template|mix directions/)
  })

  it.each([1, 2, 3])('rejects reported malformed NPC sheet %i', async (number) => {
    const input = await readFile(new URL(`./fixtures/sprites/merdeka-sprite-${number}.png`, import.meta.url))
    await expect(normalizeWalkingSpriteSheet(input)).rejects.toThrow(/pose template/)
  })
})
