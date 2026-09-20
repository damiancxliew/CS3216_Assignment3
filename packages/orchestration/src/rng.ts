/**
 * Seeded, pure PRNG. Deterministic across Node and the browser and independent of `Math.random`,
 * so the same attempt + stage + seed reproduces the same rolls (D10, K7) and a resolution can be
 * replayed from the stored record.
 */

/** FNV-1a, 32-bit. Stable for identical input strings on every platform. */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface Rng {
  /** Next value in [0, 1). */
  next(): number
  /** Integer in [min, max]. */
  int(min: number, max: number): number
  /** Deterministic pick; returns null for an empty list. */
  pick<T>(items: readonly T[]): T | null
}

/** mulberry32 over a string seed. */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed)
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => (items.length === 0 ? null : (items[Math.floor(next() * items.length)] as typeof items[number])),
  }
}
