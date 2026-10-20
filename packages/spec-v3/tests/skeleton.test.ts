import { describe, expect, it } from 'vitest'
import type { AdventureSpec, SkeletonShape } from '../src/index.js'
import { checkSkeleton, checkSpec, validateSkeleton, validateSpec } from '../src/index.js'
import { sampleSkeleton } from './sample-skeleton.js'
import { sampleSpec } from './sample.js'

const clone = () => JSON.parse(JSON.stringify(sampleSkeleton))

const checked = (mutate: (spec: any) => void = () => {}) => {
  const spec = clone()
  mutate(spec)
  const result = validateSkeleton(spec)
  if (!result.ok) throw new Error(`mutated skeleton no longer validates: ${JSON.stringify(result.issues)}`)
  return checkSkeleton(result.spec)
}

const codes = (mutate: (spec: any) => void) => checked(mutate).errors.map((e) => e.code)

// compile-time: both the zod schema output and a full AdventureSpec are SkeletonShapes
const _shape: SkeletonShape = validateSkeleton(clone()) as never as SkeletonShape
const _fromAdventure: SkeletonShape = null as unknown as AdventureSpec
void _shape
void _fromAdventure

describe('SkeletonSpec', () => {
  it('validates the sample skeleton', () => {
    expect(validateSkeleton(sampleSkeleton).ok).toBe(true)
  })

  it('requires arc', () => {
    const bad = clone()
    delete bad.arc
    expect(validateSkeleton(bad).ok).toBe(false)
  })

  it('a full AdventureSpec is a valid SkeletonShape and checks identically', () => {
    const parsed = validateSpec(sampleSpec)
    if (!parsed.ok) throw new Error('sample spec does not validate')
    const asShape: SkeletonShape = parsed.spec
    const viaSkeleton = checkSkeleton(asShape)
    const viaSpec = checkSpec(parsed.spec)
    expect(viaSpec.errors.filter((e) => viaSkeleton.errors.some((s) => s.code === e.code && s.path === e.path))).toEqual(viaSkeleton.errors)
    expect(viaSkeleton.errors).toEqual([])
  })
})

describe('checkSkeleton', () => {
  it('rejects three core discoveries assigned to one two-passage document', () => {
    const result = checked((s) => {
      s.discoveries[0].holder = { documentId: 'doc-1' }
      s.discoveries.push({ ...s.discoveries[1], id: 'd-third' })
    })
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'document-core-count', path: 'documents.0.id' }))
  })

  it('accepts two core discoveries in one document', () => {
    expect(checked((s) => { s.discoveries[0].holder = { documentId: 'doc-1' } }).errors).toEqual([])
  })

  it('reports no issues on the sample skeleton', () => {
    expect(checked()).toEqual({ errors: [], warnings: [] })
  })

  it('core-uncited', () => {
    const result = checked((s) => delete s.discoveries[0].citations)
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'core-uncited', path: 'discoveries.0.citations' }))
  })

  it('historical-uncited', () => {
    const result = checked((s) => delete s.endings[0].citations)
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'historical-uncited', path: 'endings.0.citations' }))
  })

  it('core-holder-absent when the holder is not placed in the stage', () => {
    const result = checked((s) => {
      s.characters.push({ id: 'absent', name: 'n', title: 't', real: false, tier: 'major', persona: { publicPosition: 'p', privateAgenda: 'a' } })
      s.discoveries[0].holder = { characterId: 'absent' }
    })
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'core-holder-absent', path: 'discoveries.0.holder' }))
  })

  it('decider-absent when the decider is not placed in the moment stage', () => {
    const result = checked((s) => delete s.stages[0].placement.farquhar)
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'decider-absent', path: 'definingMoments.0.deciderId' }))
  })

  it('decider-absent when the decider is a minor', () => {
    expect(codes((s) => (s.definingMoments[0].deciderId = 'nakhoda'))).toContain('decider-absent')
  })

  it('room-count', () => {
    expect(codes((s) => (s.stages[0].rooms = s.stages[0].rooms.slice(0, 1)))).toContain('room-count')
  })

  it('outcome-count', () => {
    expect(codes((s) => (s.definingMoments[0].outcomes = s.definingMoments[0].outcomes.slice(0, 2)))).toContain('outcome-count')
  })

  it('ending-mix', () => {
    expect(codes((s) => (s.endings = s.endings.filter((e: any) => e.id !== 'e-stall')))).toContain('ending-mix')
  })

  it('historical-outcome', () => {
    expect(codes((s) => (s.definingMoments[0].outcomes[1].historical = true))).toContain('historical-outcome')
  })

  it('rule-coverage for an untargeted outcome and an unruly act', () => {
    const result = checked((s) => (s.definingMoments[0].rules = s.definingMoments[0].rules.slice(0, 1)))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'rule-coverage', path: 'definingMoments.0.outcomes.1.id' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'rule-coverage', path: 'definingMoments.0.acts.1.id' }))
  })

  it('duplicate-id inside a skeleton', () => {
    const result = checked((s) => (s.discoveries[1].id = 'd-treaty'))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'duplicate-id', path: 'discoveries.1.id' }))
  })
})
