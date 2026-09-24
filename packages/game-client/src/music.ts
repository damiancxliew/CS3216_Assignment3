import type { AmbientOverlayId } from './model.js'

export const MUSIC_BY_AMBIENT: Readonly<Record<AmbientOverlayId, readonly string[]>> = {
  clear: ['calm-village', 'peaceful', 'road'],
  clouds: ['road', 'mystical', 'quiet'],
  rain: ['quiet', 'mystical', 'tension'],
  fog: ['mystical', 'quiet', 'tension'],
  night: ['quiet', 'mystical', 'peaceful'],
  dust: ['tension', 'road', 'mystical'],
  snow: ['peaceful', 'quiet', 'mystical'],
}

/** A small stable hash: the same adventure stage always gets the same soundtrack. */
function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export function selectMusicTrack(ambientId: AmbientOverlayId, seed: string): string {
  const choices = MUSIC_BY_AMBIENT[ambientId]
  return choices[hash(`${seed}:${ambientId}`) % choices.length]!
}

export const MUSIC_TRACKS = [...new Set(Object.values(MUSIC_BY_AMBIENT).flat())]
