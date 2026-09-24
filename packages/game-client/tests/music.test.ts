import { describe, expect, it } from 'vitest'
import { MUSIC_BY_AMBIENT, MUSIC_TRACKS, selectMusicTrack } from '../src/music.js'

describe('music selection', () => {
  it('is stable for the same adventure stage', () => {
    expect(selectMusicTrack('clear', 'adventure-1:stage-1')).toBe(selectMusicTrack('clear', 'adventure-1:stage-1'))
  })

  it('only chooses a track suitable for the atmosphere', () => {
    for (const ambientId of Object.keys(MUSIC_BY_AMBIENT) as Array<keyof typeof MUSIC_BY_AMBIENT>) {
      for (let stage = 0; stage < 20; stage += 1) {
        expect(MUSIC_BY_AMBIENT[ambientId]).toContain(selectMusicTrack(ambientId, `adventure-1:stage-${stage}`))
      }
    }
  })

  it('varies repeated atmospheres across stages', () => {
    const selected = new Set(Array.from({ length: 20 }, (_, stage) => selectMusicTrack('clear', `adventure-1:stage-${stage}`)))
    expect(selected.size).toBeGreaterThan(1)
  })

  it('preloads every configured track once', () => {
    const configured = Object.values(MUSIC_BY_AMBIENT).flat()
    expect(new Set(MUSIC_TRACKS)).toEqual(new Set(configured))
    expect(MUSIC_TRACKS).toHaveLength(new Set(configured).size)
  })
})
