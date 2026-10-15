import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateSpec } from '../src/index.js'
import { sampleSpec } from './sample.js'

const clone = (v: unknown) => JSON.parse(JSON.stringify(v))

describe('AdventureSpec', () => {
  it('accepts a valid sample spec', () => {
    const result = validateSpec(sampleSpec)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.spec.id).toBe('adv-1819')
  })

  it('rejects an unknown key at the top level', () => {
    const bad = { ...clone(sampleSpec), bogus: 1 }
    const result = validateSpec(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((i) => i.path)).toContain('')
  })

  it('rejects an unknown key in a nested object with the right path', () => {
    const bad = clone(sampleSpec) as { characters: { persona: Record<string, unknown> }[] }
    bad.characters[0]!.persona.extra = 'nope'
    const result = validateSpec(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.path === 'characters.0.persona')).toBe(true)
  })

  it('applies defaults when sources/conflicts/storyEvents/openQuestions/hintAngles are absent', () => {
    const sparse = clone(sampleSpec) as Record<string, unknown>
    delete sparse.storyEvents
    delete sparse.sources
    const result = validateSpec(sparse)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.sources).toEqual([])
      expect(result.spec.conflicts).toEqual([])
      expect(result.spec.storyEvents).toEqual([])
      expect(result.spec.openQuestions).toEqual([])
      expect(result.spec.hintAngles).toEqual([])
    }
  })

  it.each([null, 'x', 42, {}])('rejects %s without throwing', (input) => {
    const result = validateSpec(input)
    expect(result.ok).toBe(false)
  })
})

describe('storyEvents', () => {
  const withEvent = (event: Record<string, unknown>) => {
    const spec = clone(sampleSpec) as { storyEvents: Record<string, unknown>[] }
    spec.storyEvents = [event]
    return spec
  }

  it('fails summons without characterId', () => {
    const result = validateSpec(withEvent({ id: 'se-x', stageId: 'stage-1', effect: 'summons', when: { atSeconds: 1 }, text: 'hi' }))
    expect(result.ok).toBe(false)
  })

  it('fails move without toRoomId', () => {
    const result = validateSpec(
      withEvent({ id: 'se-x', stageId: 'stage-1', effect: 'move', characterId: 'char-farquhar', when: { atSeconds: 1 }, text: 'hi' }),
    )
    expect(result.ok).toBe(false)
  })

  it('accepts news with no extra fields', () => {
    const result = validateSpec(withEvent({ id: 'se-x', stageId: 'stage-1', effect: 'news', when: { atSeconds: 1 }, text: 'hi' }))
    expect(result.ok).toBe(true)
  })

  it('rejects a bad when shape', () => {
    const result = validateSpec(
      withEvent({ id: 'se-x', stageId: 'stage-1', effect: 'news', when: { whenever: true }, text: 'hi' }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('golden fixture', () => {
  const fixturePath = fileURLToPath(new URL('../../../fixtures/golden-1819.json', import.meta.url))
  it.skipIf(!existsSync(fixturePath))('validates fixtures/golden-1819.json', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown
    const result = validateSpec(fixture)
    expect(result.ok ? [] : result.issues).toEqual([])
  })
})
