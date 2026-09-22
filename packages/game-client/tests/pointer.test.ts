import { describe, expect, it } from 'vitest'
import { tileFromPointer } from '../src/pointer.js'

describe('pointer conversion', () => {
  it('converts world pixels to bounded integer tiles', () => {
    expect(tileFromPointer(0, 0, 24, 10, 8)).toEqual({ x: 0, y: 0 })
    expect(tileFromPointer(47.9, 48, 24, 10, 8)).toEqual({ x: 1, y: 2 })
    expect(tileFromPointer(-1, 0, 24, 10, 8)).toBeNull()
    expect(tileFromPointer(240, 0, 24, 10, 8)).toBeNull()
    expect(tileFromPointer(0, 192, 24, 10, 8)).toBeNull()
    expect(tileFromPointer(Number.NaN, 0, 24, 10, 8)).toBeNull()
  })
})
