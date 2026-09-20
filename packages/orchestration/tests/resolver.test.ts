import { describe, expect, it } from 'vitest'

import { fixtureResolverInput, fixtureTimerExpiryInput } from '../src/fixtures'
import { auditClientPayload } from '../src/privacy'
import { publicResolution, sanitizeEffects, validateResolutionRecord } from '../src/resolution'
import { resolveStageSync } from '../src/resolver/fake'
import type { ResolverInput } from '../src/resolver/types'

describe('K1 — deterministic fake resolver', () => {
  it('produces the same outcome for the same inputs', () => {
    const first = resolveStageSync(fixtureResolverInput)
    const second = resolveStageSync(fixtureResolverInput)
    expect(second).toEqual(first)
    expect(second.record.rolls).toEqual(first.record.rolls)
  })

  it('emits a schema-valid I4 payload', () => {
    const { record } = resolveStageSync(fixtureResolverInput)
    expect(validateResolutionRecord(JSON.parse(JSON.stringify(record)))).toMatchObject({ ok: true })
  })

  it('reproduces under a fixed seed and diverges when the seed changes (K7)', () => {
    const other: ResolverInput = { ...fixtureResolverInput, seed: 'harbor-2' }
    const a = resolveStageSync(fixtureResolverInput).record.rolls[0]
    const b = resolveStageSync(other).record.rolls[0]
    expect(resolveStageSync(other).record.rolls[0]).toEqual(b)
    expect(a?.value).not.toEqual(b?.value)
  })

  it('never reads the clock or Math.random', () => {
    const { record } = resolveStageSync(fixtureResolverInput)
    expect(record.resolvedAt).toBe(fixtureResolverInput.resolvedAt)
  })

  it('takes the branch the option authored, whatever the roll says (D10/FR-14)', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const { record } = resolveStageSync({ ...fixtureResolverInput, seed })
      expect(record.outcome.next).toEqual({ kind: 'stage', stageId: 'stage-settlement' })
    }
  })

  it('resolves a timer expiry without a decision (D12/FR-16)', () => {
    const { record } = resolveStageSync(fixtureTimerExpiryInput)
    expect(record.trigger).toBe('timer_expiry')
    expect(record.outcome.next).toEqual(fixtureTimerExpiryInput.fallbackNext)
    expect(record.outcome.announcement).toContain('without your word')
  })

  it('keeps disposition inside its bounds and reports a consistent delta', () => {
    const input: ResolverInput = {
      ...fixtureResolverInput,
      agents: [
        { id: 'agent-loyal', name: 'Loyal', disposition: 5 },
        { id: 'agent-hostile', name: 'Hostile', disposition: -5 },
      ],
    }
    const { record } = resolveStageSync(input)
    for (const delta of record.outcome.agentDeltas) {
      const before = input.agents.find((a) => a.id === delta.agentId)?.disposition ?? 0
      expect(delta.disposition).toBeGreaterThanOrEqual(-5)
      expect(delta.disposition).toBeLessThanOrEqual(5)
      expect(delta.disposition - before).toBe(delta.dispositionDelta)
    }
  })

  it('drops a non-allow-listed action instead of recording it (FR-20)', () => {
    const input = {
      ...fixtureResolverInput,
      actions: [
        ...fixtureResolverInput.actions,
        { actorKind: 'agent', actorId: 'agent-temenggong', action: { type: 'commit_decision', optionId: 'option-sign-treaty' } },
      ],
    } as ResolverInput
    const { record, telemetry } = resolveStageSync(input)
    expect(telemetry.droppedActions).toBe(1)
    expect(record.actions.some((a) => a.action.type === 'commit_decision')).toBe(false)
  })
})

describe('K8 — effects allow-list (FR-15b)', () => {
  it('drops an unknown effect id and still resolves the turn', () => {
    const { record, telemetry } = resolveStageSync({
      ...fixtureResolverInput,
      candidateEffects: [{ id: 'nuclear_winter', at: null, intensity: 3 }, { id: 'flash', at: null, intensity: 1 }],
    })
    expect(telemetry.droppedEffects).toBe(1)
    expect(record.outcome.effects.map((e) => e.id)).not.toContain('nuclear_winter')
    expect(record.outcome.announcement.length).toBeGreaterThan(0)
  })

  it('only ever emits catalogue ids', () => {
    const stances = ['cooperative', 'antagonistic', 'neutral', 'evasive'] as const
    for (const stance of stances) {
      for (const seed of ['s1', 's2', 's3']) {
        const { record } = resolveStageSync({
          ...fixtureResolverInput,
          seed,
          decision: { ...fixtureResolverInput.decision!, stance },
        })
        expect(sanitizeEffects(record.outcome.effects).dropped).toHaveLength(0)
      }
    }
  })
})

describe('FR-21 — server authority', () => {
  const privateStrings = [
    'stance=cooperative',
    'Reads the outcome as a slight, and will remember it next stage.',
    'Reads the outcome as an opening worth using next stage.',
  ]

  it('keeps rolls, private notes and rationale out of the public projection', () => {
    const { record } = resolveStageSync(fixtureResolverInput)
    const payload = publicResolution(record)

    expect(record.rolls.length).toBeGreaterThan(0)
    expect(record.rationale.length).toBeGreaterThan(0)
    expect(record.privateNotes.length).toBeGreaterThan(0)

    const audit = auditClientPayload(payload, [...privateStrings, record.rationale])
    expect(audit).toEqual({ ok: true, forbiddenKeys: [], leakedText: [] })
    expect(Object.keys(payload).sort()).toEqual(['announcement', 'effects', 'ending', 'nextStageId'])
  })

  it('never leaks the roll even when the announcement mentions the outcome', () => {
    for (const seed of ['x1', 'x2', 'x3', 'x4', 'x5']) {
      const { record } = resolveStageSync({ ...fixtureResolverInput, seed })
      const payload = publicResolution(record)
      const rolled = String(record.rolls[0]?.value ?? '')
      expect(JSON.stringify(payload)).not.toContain(rolled)
      expect(JSON.stringify(payload)).not.toContain('probability')
    }
  })

  it('gives every projected effect a text equivalent (FR-15c)', () => {
    const { record } = resolveStageSync(fixtureResolverInput)
    for (const effect of publicResolution(record).effects) {
      expect(effect.text.length).toBeGreaterThan(0)
    }
  })
})
