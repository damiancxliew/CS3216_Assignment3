import { describe, expect, it } from 'vitest'
import { passingRemark, streetTalk } from '../src/street-talk.js'

describe('street talk', () => {
  it('is stable for a seed so a passer-by keeps one identity', () => {
    const first = streetTalk('map-1:street-0', 'harbor', 'The docks argue about the treaty')
    const second = streetTalk('map-1:street-0', 'harbor', 'The docks argue about the treaty')
    expect(second).toEqual(first)
    expect(first.name).not.toBe(streetTalk('map-1:street-3', 'harbor').name)
  })

  it('draws lines from the public setting and its context', () => {
    const talk = streetTalk('map-1:street-2', 'civic', 'The council will hold a vote on the treaty')
    expect(talk.lines.length).toBeGreaterThan(1)
    expect(talk.lines.some((line) => /treaty|vote/i.test(line))).toBe(true)
  })

  it('gives every setting something to say in passing', () => {
    for (const art of ['civic', 'harbor', 'village', 'jungle', 'desert', 'industrial', 'winter', 'palace', 'ruins', 'battlefield'] as const) {
      expect(passingRemark('seed', art).length).toBeGreaterThan(0)
    }
  })
})
