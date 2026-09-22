import { describe, expect, it } from 'vitest'

import {
  createFixtureWorld,
  fixtureOptionCatalogue,
  fixtureStageConfig,
  fixtureStageParticipants,
} from '../src/fixtures'
import { FakeLlmClient } from '../src/llm/fake'
import { deriveOptions, evaluatePrecondition, isHiddenFrom, parseOptionsVersion, StageDecisions } from '../src/stage/options'
import { runStage } from '../src/world/stage-runtime'
import { applyAction, type WorldState } from '../src/world/state'

const ledger = () => new StageDecisions(fixtureStageParticipants)

const shutTheHall = (world: WorldState): void => {
  applyAction(world, {
    actorKind: 'agent',
    actorId: 'agent-farquhar',
    action: { type: 'close_door', roomId: 'room-audience-hall' },
  })
}

describe('option maintenance (K6)', () => {
  it('derives options from state, dropping the ones whose preconditions fail', () => {
    const world = createFixtureWorld()
    expect(deriveOptions(world, fixtureOptionCatalogue).options.map((option) => option.id)).toEqual([
      'option-sign-treaty',
      'option-press-farquhar',
      'option-walk-away',
    ])

    shutTheHall(world)
    expect(deriveOptions(world, fixtureOptionCatalogue).options.map((option) => option.id)).toEqual([
      'option-sign-treaty',
      'option-walk-away',
    ])
  })

  it('changes the version when the set changes, and not otherwise', () => {
    const world = createFixtureWorld()
    const before = deriveOptions(world, fixtureOptionCatalogue).version
    expect(deriveOptions(createFixtureWorld(), fixtureOptionCatalogue).version).toBe(before)

    shutTheHall(world)
    expect(deriveOptions(world, fixtureOptionCatalogue).version).not.toBe(before)
  })

  it('rejects an option that was valid when it was offered but is not any more', () => {
    const world = createFixtureWorld()
    const offered = deriveOptions(world, fixtureOptionCatalogue)
    expect(offered.options.map((option) => option.id)).toContain('option-press-farquhar')

    // The world moves on: Farquhar shuts the hall, so pressing him in the open hall is gone.
    shutTheHall(world)

    const decisions = ledger()
    const result = decisions.commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-press-farquhar',
      optionsVersion: offered.version,
    })

    expect(result).toEqual({ ok: false, reason: 'option_unavailable', detail: expect.any(String) })
    // Rejection, not mutation: the actor is still pending and nothing was recorded.
    expect(decisions.pending()).toContain('player')
    expect(decisions.all()).toEqual([])
  })

  it('rejects an option that becomes unavailable after it was offered', () => {
    const world = createFixtureWorld()
    const offered = deriveOptions(world, fixtureOptionCatalogue)
    shutTheHall(world)

    const result = ledger().commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-press-farquhar',
      optionsVersion: offered.version,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('option_unavailable')
  })

  it('allows a commit when an unrelated option disappears', () => {
    const world = createFixtureWorld()
    const offered = deriveOptions(world, fixtureOptionCatalogue)
    applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-farquhar',
      action: { type: 'move_room', toRoomId: 'room-tally-shed' },
    })

    const result = ledger().commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-sign-treaty',
      optionsVersion: offered.version,
    })

    expect(result.ok).toBe(true)
  })

  it('rejects an option whose submitted availability bit was unset', () => {
    const world = createFixtureWorld()
    shutTheHall(world)
    const offered = deriveOptions(world, fixtureOptionCatalogue)
    applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-farquhar',
      action: { type: 'open_door', roomId: 'room-audience-hall' },
    })

    const result = ledger().commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-press-farquhar',
      optionsVersion: offered.version,
    })

    expect(result).toEqual({ ok: false, reason: 'stale_option_set', detail: expect.any(String) })
  })

  it('rejects a version minted against a different catalogue', () => {
    const world = createFixtureWorld()
    const offered = deriveOptions(world, fixtureOptionCatalogue.slice(0, -1))
    const result = ledger().commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-sign-treaty',
      optionsVersion: offered.version,
    })

    expect(result).toEqual({ ok: false, reason: 'stale_option_set', detail: expect.any(String) })
  })

  it('hides evidence-gated options from other viewers and does not reveal the label', () => {
    const option = {
      id: 'option-read-tally',
      label: 'Read the harbour master\u2019s secret tally',
      preconditions: [
        {
          kind: 'knows_evidence' as const,
          actorId: 'agent-harbour-master',
          evidenceId: 'evidence-tally-book',
        },
      ],
    }
    const world = createFixtureWorld()
    expect(deriveOptions(world, [option], 'agent-harbour-master').options).toEqual([
      { id: option.id, label: option.label },
    ])
    expect(deriveOptions(world, [option], 'agent-temenggong').options).toEqual([])
    expect(isHiddenFrom(option, 'agent-temenggong')).toBe(true)

    const result = ledger().commit(world, [option], {
      actorId: 'agent-temenggong',
      actorKind: 'agent',
      optionId: option.id,
      optionsVersion: deriveOptions(world, [option], 'agent-temenggong').version,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'unknown_option',
      detail: expect.not.stringContaining(option.label),
    })
  })

  it('parses long option masks without numeric bitmask overflow', () => {
    const catalogue = Array.from({ length: 40 }, (_, index) => ({
      id: `option-${index}`,
      label: `Option ${index}`,
      preconditions: [],
    }))
    const parsed = parseOptionsVersion(deriveOptions(createFixtureWorld(), catalogue).version)
    expect(parsed?.bits.slice(0, 40)).toEqual(Array(40).fill(true))
  })

  it('accepts a commit against the live set, once', () => {
    const world = createFixtureWorld()
    const live = deriveOptions(world, fixtureOptionCatalogue)
    const decisions = ledger()

    const first = decisions.commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-sign-treaty',
      optionsVersion: live.version,
    })
    expect(first.ok).toBe(true)

    const second = decisions.commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-walk-away',
      optionsVersion: live.version,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('already_decided')
    expect(decisions.all()).toHaveLength(1)
  })

  it('rejects an id that is in no catalogue at all', () => {
    const world = createFixtureWorld()
    const result = ledger().commit(world, fixtureOptionCatalogue, {
      actorId: 'player',
      actorKind: 'player',
      optionId: 'option-burn-the-ledgers',
      optionsVersion: deriveOptions(world, fixtureOptionCatalogue).version,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unknown_option')
  })

  it('passes everyone still undecided when the timer expires (D12/FR-16)', () => {
    const decisions = ledger()
    decisions.pass('agent-farquhar')
    const timedOut = decisions.expire()

    expect(timedOut.map((decision) => decision.actorId).sort()).toEqual(['agent-temenggong', 'player'])
    expect(timedOut.every((decision) => decision.optionId === null && decision.how === 'timed_out')).toBe(true)
    expect(decisions.settled()).toBe(true)
  })

  it('restores a persisted ledger without re-validating old commits, and ignores strangers', () => {
    const decisions = ledger()
    decisions.pass('agent-farquhar')
    const stored = [
      ...decisions.all(),
      { actorId: 'player', actorKind: 'player' as const, optionId: 'opt-a', how: 'committed' as const },
      { actorId: 'agent-nobody', actorKind: 'agent' as const, optionId: null, how: 'passed' as const },
      { actorId: 'agent-temenggong', actorKind: 'player' as const, optionId: null, how: 'passed' as const },
    ]

    const restored = StageDecisions.restore(fixtureStageParticipants, stored)
    expect(restored.has('agent-farquhar')).toBe(true)
    expect(restored.has('player')).toBe(true)
    expect(restored.has('agent-nobody')).toBe(false)
    expect(restored.has('agent-temenggong')).toBe(false) // wrong kind for that participant
    expect(restored.pending()).toEqual(['agent-temenggong'])
    expect(restored.humansDecided()).toBe(true)
    expect(restored.all().find((d) => d.actorId === 'player')?.optionId).toBe('opt-a')
  })
})

describe('agents decide by the player\u2019s rules', () => {
  const decisionConfig = (decisions: StageDecisions) => ({
    ...fixtureStageConfig,
    decision: { catalogue: fixtureOptionCatalogue, ledger: decisions },
    maxTicks: 3,
  })

  it('records an agent commit through the same ledger as a player commit', async () => {
    const world = createFixtureWorld()
    const decisions = ledger()
    const client = new FakeLlmClient({
      replies: [JSON.stringify({ say: '', actions: [{ type: 'commit_decision', optionId: 'option-sign-treaty' }] })],
    })

    const { telemetry } = await runStage(client, world, decisionConfig(decisions))

    expect(telemetry.decisions.map((decision) => [decision.actorId, decision.optionId])).toEqual([
      ['agent-temenggong', 'option-sign-treaty'],
      ['agent-farquhar', 'option-sign-treaty'],
    ])
    expect(telemetry.rejectedDecisions).toEqual([])
    expect(decisions.pending()).toEqual(['player'])
  })

  it('ends the stage as soon as every actor has decided', async () => {
    const world = createFixtureWorld()
    const decisions = ledger()
    decisions.pass('player')
    const client = new FakeLlmClient({
      replies: [JSON.stringify({ say: '', actions: [{ type: 'commit_decision', optionId: 'option-walk-away' }] })],
    })

    const { telemetry } = await runStage(client, world, decisionConfig(decisions))

    expect(decisions.settled()).toBe(true)
    expect(telemetry.stoppedBy).toBe('all_decided')
    expect(telemetry.ticks).toBe(1)
  })

  it('tells an agent to decide now once every human is in, and not before', async () => {
    const world = createFixtureWorld()
    const decisions = ledger()
    const client = new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] })

    await runStage(client, world, decisionConfig(decisions))
    expect(client.requests.some((request) => request.system.includes('Decide now'))).toBe(false)

    decisions.pass('player')
    const after = new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] })
    await runStage(after, world, decisionConfig(decisions))
    expect(after.requests.every((request) => request.system.includes('Decide now'))).toBe(true)
  })

  it('stamps the version the agent was shown, so a commit against a moved-on world is rejected', async () => {
    const world = createFixtureWorld()
    const decisions = ledger()
    // The Resident shuts the hall on his own tick, which removes an option mid-stage; the
    // Temenggong's commit is evaluated against the set as it stands when it lands.
    const client = new FakeLlmClient({
      replies: [
        JSON.stringify({
          say: '',
          actions: [
            { type: 'close_door', roomId: 'room-audience-hall' },
            { type: 'commit_decision', optionId: 'option-press-farquhar' },
          ],
        }),
        JSON.stringify({ say: '', actions: [{ type: 'commit_decision', optionId: 'option-press-farquhar' }] }),
      ],
    })

    const { telemetry } = await runStage(client, world, decisionConfig(decisions))

    expect(telemetry.decisions).toEqual([])
    expect(telemetry.rejectedDecisions.map((rejection) => rejection.reason)).toContain('option_unavailable')
    expect(decisions.pending()).toContain('agent-farquhar')
  })

  it('shows every deciding agent the same public option labels and nothing more', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] })
    await runStage(client, world, decisionConfig(ledger()))

    for (const request of client.requests) {
      expect(request.user).toContain('option-sign-treaty: Sign the treaty with the Temenggong')
      // Preconditions are authoring data, not something a character is told.
      expect(request.user).not.toContain('actors_together')
      expect(request.user).not.toContain('precondition')
    }
  })
})

describe('heard_from (K6 for "talk to X" objectives)', () => {
  it('holds once the actor has heard the speaker while present, and not for lines behind a closed door', () => {
    const world = createFixtureWorld()
    const heard = { kind: 'heard_from' as const, actorId: 'player', speakerId: 'agent-harbour-master' }
    expect(evaluatePrecondition(world, heard)).toBe(false)

    // The harbour master speaks in the tally shed while the player is in the hall: unheard.
    applyAction(world, { actorKind: 'agent', actorId: 'agent-harbour-master', action: { type: 'speak', roomId: 'room-tally-shed', body: 'Ledgers balance.', addresseeId: null } })
    expect(evaluatePrecondition(world, heard)).toBe(false)

    // The player walks in; earlier lines are not backfilled (FR-11), a new one counts.
    applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'move_room', toRoomId: 'room-tally-shed' } })
    expect(evaluatePrecondition(world, heard)).toBe(false)
    applyAction(world, { actorKind: 'agent', actorId: 'agent-harbour-master', action: { type: 'speak', roomId: 'room-tally-shed', body: 'Ah, a visitor.', addresseeId: 'player' } })
    expect(evaluatePrecondition(world, heard)).toBe(true)

    // The player's own line does not satisfy it, and another viewer is not shown the option.
    expect(evaluatePrecondition(world, { ...heard, speakerId: 'player' })).toBe(false)
    const option = { id: 'opt-x', label: 'x', preconditions: [heard] }
    expect(isHiddenFrom(option, 'agent-temenggong')).toBe(true)
    expect(isHiddenFrom(option, 'player')).toBe(false)
  })
})
