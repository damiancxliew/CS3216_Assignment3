import { describe, expect, it } from 'vitest'

import { matchMapPalette } from '../src/pixel-art.js'

describe('generated map fixture palette', () => {
  it('turns soft pixels into hard opaque pixels and preserves transparency', () => {
    const pixels = new Uint8ClampedArray([250, 245, 235, 240, 20, 35, 48, 40])
    matchMapPalette(pixels, 'winter')
    expect(pixels[3]).toBe(255)
    expect(pixels.slice(4)).toEqual(new Uint8ClampedArray([0, 0, 0, 0]))
    expect([...pixels.slice(0, 3)]).not.toEqual([250, 245, 235])
  })

  it('uses the selected map theme for accent colors', () => {
    const winter = new Uint8ClampedArray([90, 155, 88, 255])
    const forest = new Uint8ClampedArray(winter)
    matchMapPalette(winter, 'winter')
    matchMapPalette(forest, 'forest')
    expect([...forest]).not.toEqual([...winter])
  })
})
