import { describe, expect, it } from 'vitest'

import {
  ACTION_TYPES,
  AGENT_ACTION_TYPES,
  DEFAULT_ACTION_BUDGET,
  filterActions,
  parseAction,
} from '../src/actions'

describe('action allow-list (FR-20)', () => {
  it('accepts every agent action in the closed set', () => {
    const samples: Record<string, unknown> = {
      speak: { type: 'speak', roomId: 'room-hall', body: 'Where were you last night?', addresseeId: null },
      move_room: { type: 'move_room', toRoomId: 'room-archive' },
      open_door: { type: 'open_door', roomId: 'room-hall' },
      close_door: { type: 'close_door', roomId: 'room-hall' },
      share_evidence: { type: 'share_evidence', roomId: 'room-hall', evidenceId: 'evidence-ledger' },
      record_private_note: { type: 'record_private_note', note: 'The clerk is lying about the ledger.' },
      commit_decision: { type: 'commit_decision', optionId: 'option-sign', optionsVersion: 'v1' },
      pass: { type: 'pass' },
      yield: { type: 'yield' },
    }
    for (const type of AGENT_ACTION_TYPES) {
      expect(parseAction(samples[type], 'agent'), type).toMatchObject({ ok: true })
    }
  })

  it('drops an action that is not on the list rather than failing the turn', () => {
    const result = parseAction({ type: 'burn_down_the_archive', roomId: 'room-archive' }, 'agent')
    expect(result).toEqual({
      ok: false,
      dropped: {
        reason: 'not_allow_listed',
        type: 'burn_down_the_archive',
        detail: '"burn_down_the_archive" is not an allow-listed action',
      },
    })
  })

  it('drops a non-object and a missing type without throwing', () => {
    for (const candidate of [null, undefined, 42, 'speak', [], {}]) {
      const result = parseAction(candidate, 'agent')
      expect(result.ok).toBe(false)
    }
  })

  it('lets either kind of actor decide, by the same rules (revised D18, 20 Sep)', () => {
    const decision = { type: 'commit_decision', optionId: 'option-sign', optionsVersion: 'v1' }
    expect(parseAction(decision, 'agent')).toMatchObject({ ok: true })
    expect(parseAction(decision, 'player')).toMatchObject({ ok: true })
    expect(parseAction({ type: 'pass' }, 'agent')).toMatchObject({ ok: true })
    expect(parseAction({ type: 'pass' }, 'player')).toMatchObject({ ok: true })
  })

  it('refuses a decision that names no option set: staleness has to be checkable (K6)', () => {
    expect(parseAction({ type: 'commit_decision', optionId: 'option-sign' }, 'player')).toMatchObject({
      ok: false,
      dropped: { reason: 'malformed_payload' },
    })
  })

  it('refuses a player-emitted private note: only agents write agent memory', () => {
    expect(parseAction({ type: 'record_private_note', note: 'remember this' }, 'player')).toMatchObject({
      ok: false,
      dropped: { reason: 'actor_not_permitted' },
    })
  })

  it('has no action that carries free text as an instruction', () => {
    // `speak` is conversation; every other action carries ids only. This is what stops a model (or
    // an injected document) turning prose into a world change (D18/FR-20).
    const freeTextCarrying = ACTION_TYPES.filter((type) => type === 'speak' || type === 'record_private_note')
    expect(freeTextCarrying).toEqual(['speak', 'record_private_note'])
  })

  it('rejects a malformed payload for an allow-listed type', () => {
    expect(parseAction({ type: 'speak', roomId: '', body: '', addresseeId: null }, 'agent')).toMatchObject({
      ok: false,
      dropped: { reason: 'malformed_payload' },
    })
    expect(parseAction({ type: 'move_room' }, 'agent')).toMatchObject({ ok: false, dropped: { reason: 'malformed_payload' } })
  })
})

describe('budget rails (FR-12b)', () => {
  const actor = { actorKind: 'agent', actorId: 'agent-clerk' } as const

  it('caps actions per actor per stage', () => {
    const candidates = Array.from({ length: DEFAULT_ACTION_BUDGET.maxActionsPerActor + 3 }, () => ({
      type: 'speak',
      roomId: 'room-hall',
      body: 'Another thought.',
      addresseeId: null,
    }))
    const result = filterActions(candidates, actor)
    expect(result.actions).toHaveLength(DEFAULT_ACTION_BUDGET.maxActionsPerActor)
    expect(result.dropped).toHaveLength(3)
    expect(result.dropped.every((d) => d.reason === 'budget_exhausted')).toBe(true)
  })

  it('lets an idle agent yield for free', () => {
    const result = filterActions(
      Array.from({ length: 20 }, () => ({ type: 'yield' })),
      actor,
    )
    expect(result.actions).toHaveLength(20)
    expect(result.dropped).toHaveLength(0)
  })

  it('counts a budget already spent earlier in the stage', () => {
    const result = filterActions([{ type: 'move_room', toRoomId: 'room-archive' }], actor, DEFAULT_ACTION_BUDGET, DEFAULT_ACTION_BUDGET.maxActionsPerActor)
    expect(result.actions).toHaveLength(0)
    expect(result.dropped[0]?.reason).toBe('budget_exhausted')
  })

  it('caps a batch at the stage-wide remainder', () => {
    const result = filterActions(
      Array.from({ length: 3 }, (_, index) => ({
        type: 'speak',
        roomId: 'room-hall',
        body: `Thought ${index}.`,
        addresseeId: null,
      })),
      actor,
      { maxActions: 10, maxActionsPerActor: 10 },
      0,
      2,
    )
    expect(result.actions).toHaveLength(2)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe('budget_exhausted')
  })

  it('reports a drop rate for telemetry (FR-24)', () => {
    const result = filterActions([{ type: 'yield' }, { type: 'teleport' }], actor)
    expect(result.dropRate).toBe(0.5)
  })
})
