import { describe, expect, it } from 'vitest'
import { selectPropHintId, selectPropHitId } from '../src/prop-hint.js'

describe('document interaction hint', () => {
  it('shows one hint on the nearest unread document', () => {
    expect(selectPropHintId([
      { id: 'far-brief', position: { x: 8, y: 8 } },
      { id: 'near-bulletin', position: { x: 4, y: 5 } },
    ], { x: 3, y: 5 })).toBe('near-bulletin')
  })

  it('uses the id as a stable tie-breaker', () => {
    expect(selectPropHintId([
      { id: 'z-document', position: { x: 2, y: 1 } },
      { id: 'a-document', position: { x: 0, y: 1 } },
    ], { x: 1, y: 1 })).toBe('a-document')
  })

  it('shows no hint without a player or unread documents', () => {
    expect(selectPropHintId([], { x: 1, y: 1 })).toBeNull()
    expect(selectPropHintId([{ id: 'brief', position: { x: 1, y: 1 } }], null)).toBeNull()
  })
})

describe('document click target', () => {
  it('accepts a click on the prompt above the document tile', () => {
    expect(selectPropHitId([{
      id: 'brief',
      position: { x: 40, y: 72 },
      bounds: { x: 20, y: 40, width: 40, height: 48 },
    }], { x: 40, y: 44 })).toBe('brief')
  })

  it('ignores clicks outside the visible document UI', () => {
    expect(selectPropHitId([{
      id: 'brief',
      position: { x: 40, y: 72 },
      bounds: { x: 20, y: 40, width: 40, height: 48 },
    }], { x: 10, y: 44 })).toBeNull()
  })
})
