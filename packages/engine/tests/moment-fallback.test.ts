import { describe, expect, it } from 'vitest'
import { unconditionalOutcomeIds } from '@adventure/spec-v3'
import { createState } from '../src'
import { resolveOutcome } from '../src/rules/moment'
import { mini } from './fixtures/mini'

describe('ordered moment fallbacks', () => {
  it('agrees with generation context while preserving open-ending preference and conditional priority', () => {
    const spec = structuredClone(mini)
    const moment = spec.definingMoments[1]!
    moment.rules.unshift({ actId: 'wait', outcomeId: 'o-alt2' })
    const state = createState(spec, 'fallback')
    const [fallback, alternate] = unconditionalOutcomeIds(moment, 'wait')
    expect(fallback).toBe('o-alt2')
    expect(alternate).toBe('o-alt1')
    expect(resolveOutcome(spec, state, moment, 'wait', 0).id).toBe(fallback)
    state.closedEndings.push('e-alt2')
    expect(resolveOutcome(spec, state, moment, 'wait', 0).id).toBe(alternate)

    moment.rules.unshift({ actId: 'wait', outcomeId: 'o-hist', when: { discovered: 'd-a1' } })
    state.discovered.push('d-a1')
    expect(unconditionalOutcomeIds(moment, 'wait')).toEqual([fallback, alternate])
    expect(resolveOutcome(spec, state, moment, 'wait', 0).id).toBe('o-hist')
  })
})
