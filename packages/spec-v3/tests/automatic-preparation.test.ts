import { describe, expect, it } from 'vitest'
import { validateSpec } from '../src/index.js'
import { automaticPreparationIssues } from '../src/check/automatic-preparation.js'
import { sampleSpec } from './sample.js'

function fixture() {
  const parsed = validateSpec(structuredClone(sampleSpec))
  if (!parsed.ok) throw Error('Invalid fixture')
  const spec = parsed.spec
  spec.stages[0]!.preparation = { characters: {}, decision: [], essentialCharacters: [{ characterId: 'char-farquhar', discoveryIds: ['disc-1'] }] }
  spec.triggers = [
    { id: 'rise', characterId: 'char-farquhar', on: { discovered: 'disc-2' }, effect: { stanceDelta: 1 }, notice: 'He opens up.' },
    { id: 'fall', characterId: 'char-farquhar', on: { discovered: 'disc-2' }, effect: { stanceDelta: -1 }, notice: 'He becomes guarded.' },
  ]
  return spec
}

describe('automatic preparation transitions', () => {
  it('rejects opposing automatic transitions that settle together in a prepared stage', () => {
    expect(automaticPreparationIssues(fixture())).toEqual([expect.objectContaining({ code: 'preparation', path: 'triggers.1.effect' })])
  })
  it('rejects competing explicit stance targets for the same automatic discovery', () => {
    const spec = fixture()
    spec.triggers[0]!.effect = { toStance: 'st-2' }
    spec.triggers[1]!.effect = { toStance: 'st-1' }
    expect(automaticPreparationIssues(spec)).toHaveLength(1)
  })
  it.each(['relative-first', 'absolute-first'] as const)('rejects mixed relative and absolute transitions (%s)', (order) => {
    const spec = fixture()
    const absolute = order === 'relative-first' ? 1 : 0
    const relative = order === 'relative-first' ? 0 : 1
    spec.triggers[absolute]!.effect = { toStance: 'st-1' }
    spec.triggers[relative]!.effect = { stanceDelta: 1 }
    expect(automaticPreparationIssues(spec)).toHaveLength(1)
  })
  it('permits matching transitions, independent discoveries and student-controlled note exchanges', () => {
    for (const change of ['matching', 'independent', 'student'] as const) {
      const spec = fixture()
      if (change === 'matching') spec.triggers[1]!.effect = { stanceDelta: 1 }
      if (change === 'independent') spec.triggers[1]!.on = { discovered: 'disc-3' }
      if (change === 'student') spec.triggers[1]!.on = { notePassed: 'disc-2' }
      expect(automaticPreparationIssues(spec), change).toEqual([])
    }
  })
  it('leaves legacy stages unchanged and ignores characters absent from the prepared stage', () => {
    const legacy = fixture()
    delete legacy.stages[0]!.preparation
    expect(automaticPreparationIssues(legacy)).toEqual([])
    const absent = fixture()
    delete absent.stages[0]!.placement['char-farquhar']
    expect(automaticPreparationIssues(absent)).toEqual([])
  })
  it('rejects unconditional competing transitions driven by different earlier-stage facts', () => {
    const spec = fixture()
    spec.stages.push({ ...structuredClone(spec.stages[0]!), id: 'later-stage', situations: [] })
    delete spec.stages[0]!.preparation
    spec.triggers[1]!.on = { discovered: 'disc-3' }
    expect(automaticPreparationIssues(spec)).toHaveLength(1)
  })
  it('does not flag a transition whose own condition contradicts its firing discovery', () => {
    const spec = fixture()
    spec.triggers[1]!.requires = { not: { discovered: 'disc-2' } }
    expect(automaticPreparationIssues(spec)).toEqual([])
  })
})
