import { describe, expect, it } from 'vitest'

import {
  createFixtureWorld,
  fixtureFarquharPrivate,
  fixtureAgentTurnInput,
  fixtureOptionCatalogue,
  fixtureStageConfig,
  fixtureStageParticipants,
  fixtureTemenggongPrivate,
} from '../src/fixtures'
import { buildAgentPrompt } from '../src/agent/prompt'
import { filterActions } from '../src/actions'
import { FakeLlmClient } from '../src/llm/fake'
import type { LlmRequest } from '../src/llm/types'
import { findLeakedText } from '../src/privacy'
import { ReplyInbox, ReplyRateLimiter, submitPlayerMessage } from '../src/world/reply'
import { StageDecisions } from '../src/stage/options'
import { buildAgentTurnInput, runStage, type StageConfig } from '../src/world/stage-runtime'
import {
  applyAction,
  createWorld,
  validateWorldSeed,
  visibleTranscript,
  type WorldSeed,
  type WorldState,
} from '../src/world/state'

const SECRET_BEHIND_THE_DOOR = 'The Dutch envoy is already ashore at Karimun.'

const speak = (actorId: string, roomId: string, body: string) => ({
  actorKind: 'agent' as const,
  actorId,
  action: { type: 'speak' as const, roomId, body, addresseeId: null },
})

/** Temenggong and Farquhar shut themselves in the tally shed and say something the others miss. */
function closedDoorExchange(): WorldState {
  const world = createFixtureWorld()
  applyAction(world, { actorKind: 'agent', actorId: 'agent-temenggong', action: { type: 'move_room', toRoomId: 'room-tally-shed' } })
  applyAction(world, { actorKind: 'agent', actorId: 'agent-harbour-master', action: { type: 'move_room', toRoomId: 'room-audience-hall' } })
  applyAction(world, { actorKind: 'agent', actorId: 'agent-temenggong', action: { type: 'close_door', roomId: 'room-tally-shed' } })
  applyAction(world, speak('agent-temenggong', 'room-tally-shed', SECRET_BEHIND_THE_DOOR))
  return world
}

describe('room-scoped visibility (K3)', () => {
  it('delivers a player message only to its addressee', () => {
    const world = createFixtureWorld()
    applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: {
        type: 'speak',
        roomId: 'room-audience-hall',
        body: 'Temenggong, what would the treaty cost?',
        addresseeId: 'agent-temenggong',
      },
    })

    expect(buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3).playerMessage).toBe(
      'Temenggong, what would the treaty cost?',
    )
    expect(buildAgentTurnInput(world, 'agent-farquhar', fixtureStageConfig, 3).playerMessage).toBeNull()
  })

  it('keeps an addressed player message until that agent answers', () => {
    const world = createFixtureWorld()
    applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: {
        type: 'speak',
        roomId: 'room-audience-hall',
        body: 'Temenggong, what would the treaty cost?',
        addresseeId: 'agent-temenggong',
      },
    })
    applyAction(world, speak('agent-farquhar', 'room-audience-hall', 'The Company is listening.'))
    expect(buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3).playerMessage).toBe(
      'Temenggong, what would the treaty cost?',
    )

    applyAction(world, speak('agent-temenggong', 'room-audience-hall', 'I will answer in time.'))
    expect(buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3).playerMessage).toBeNull()
  })

  it('keeps ambient player speech visible without treating it as a player message', () => {
    const world = createFixtureWorld()
    applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: {
        type: 'speak',
        roomId: 'room-audience-hall',
        body: 'The river is unusually quiet today.',
        addresseeId: null,
      },
    })

    expect(buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3).playerMessage).toBeNull()
    expect(buildAgentTurnInput(world, 'agent-farquhar', fixtureStageConfig, 3).playerMessage).toBeNull()
    expect(visibleTranscript(world, 'agent-temenggong').map((line) => line.body)).toContain(
      'The river is unusually quiet today.',
    )
    expect(visibleTranscript(world, 'agent-farquhar').map((line) => line.body)).toContain(
      'The river is unusually quiet today.',
    )
  })

  it('an agent cannot recall a fact stated in a closed room it was absent from', () => {
    const world = closedDoorExchange()
    expect(visibleTranscript(world, 'agent-temenggong').map((line) => line.body)).toContain(SECRET_BEHIND_THE_DOOR)
    expect(visibleTranscript(world, 'agent-harbour-master')).toEqual([])
    expect(visibleTranscript(world, 'agent-farquhar')).toEqual([])
    expect(visibleTranscript(world, 'player')).toEqual([])
  })

  it('keeps it out of the absent agent\u2019s prompt, not just out of the query', () => {
    const world = closedDoorExchange()
    const input = buildAgentTurnInput(world, 'agent-farquhar', fixtureStageConfig, 3)
    if (input === null) throw new Error('fixture agent should be routable')
    expect(findLeakedText(input, [SECRET_BEHIND_THE_DOOR])).toEqual([])
  })

  it('a closed door blocks movement, which is what makes the room private (D7)', () => {
    const world = closedDoorExchange()
    const result = applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-farquhar',
      action: { type: 'move_room', toRoomId: 'room-tally-shed' },
    })
    expect(result).toEqual({ ok: false, reason: 'the door of "room-tally-shed" is closed' })
    expect(world.location['agent-farquhar']).toBe('room-audience-hall')
  })

  it('walking in afterwards does not backfill what was said before (FR-11)', () => {
    const world = closedDoorExchange()
    applyAction(world, { actorKind: 'agent', actorId: 'agent-temenggong', action: { type: 'open_door', roomId: 'room-tally-shed' } })
    applyAction(world, { actorKind: 'agent', actorId: 'agent-farquhar', action: { type: 'move_room', toRoomId: 'room-tally-shed' } })
    expect(visibleTranscript(world, 'agent-farquhar')).toEqual([])
  })

  it('an agent recalls what it heard elsewhere, tagged with the room', () => {
    const world = createFixtureWorld()
    applyAction(world, speak('agent-farquhar', 'room-audience-hall', 'The Company asks only for ground.'))
    applyAction(world, { actorKind: 'agent', actorId: 'agent-temenggong', action: { type: 'move_room', toRoomId: 'room-tally-shed' } })
    const input = buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3)
    if (input === null) throw new Error('fixture agent should be routable')
    expect(input.transcript).toEqual([])
    expect(input.recalled).toEqual([
      {
        speakerId: 'agent-farquhar',
        speakerName: 'William Farquhar',
        body: 'The Company asks only for ground.',
        roomName: 'Audience hall',
      },
    ])
  })

  it('shared evidence reaches everyone in the room and nobody outside it', () => {
    const world = createFixtureWorld()
    applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-harbour-master',
      action: { type: 'share_evidence', roomId: 'room-tally-shed', evidenceId: 'evidence-tally-book' },
    })
    expect(world.evidenceKnown['agent-temenggong']).toEqual([])
    applyAction(world, { actorKind: 'agent', actorId: 'agent-temenggong', action: { type: 'move_room', toRoomId: 'room-tally-shed' } })
    applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-harbour-master',
      action: { type: 'share_evidence', roomId: 'room-tally-shed', evidenceId: 'evidence-tally-book' },
    })
    expect(world.evidenceKnown['agent-temenggong']).toEqual(['evidence-tally-book'])
    expect(world.evidenceKnown['agent-farquhar']).toEqual([])
  })
  function closeTallyShed(world: WorldState): void {
    expect(
      applyAction(world, {
        actorKind: 'agent',
        actorId: 'agent-harbour-master',
        action: { type: 'close_door', roomId: 'room-tally-shed' },
      }),
    ).toEqual({ ok: true })
  }

  it('a knock is heard only by occupants of the target room', () => {
    const world = createFixtureWorld()
    closeTallyShed(world)
    const result = applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-temenggong',
      action: { type: 'knock', roomId: 'room-tally-shed' },
    })

    expect(result).toEqual({ ok: true })
    expect(world.transcript).toEqual([
      {
        tick: 0,
        seq: 1,
        roomId: 'room-tally-shed',
        speakerId: 'agent-temenggong',
        speakerName: 'Temenggong Abdul Rahman',
        addresseeId: null,
        body: 'Temenggong Abdul Rahman knocks.',
      },
    ])
    expect(visibleTranscript(world, 'agent-harbour-master').map((line) => line.body)).toEqual([
      'Temenggong Abdul Rahman knocks.',
    ])
    expect(visibleTranscript(world, 'agent-farquhar')).toEqual([])
    expect(visibleTranscript(world, 'player')).toEqual([])
    expect(visibleTranscript(world, 'agent-temenggong')).toEqual([])
    expect(world.events.at(-1)).toMatchObject({ actorId: 'agent-temenggong', kind: 'knock', roomId: 'room-tally-shed' })

    const playerResult = applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: { type: 'knock', roomId: 'room-tally-shed' },
    })
    expect(playerResult).toEqual({ ok: true })
    expect(visibleTranscript(world, 'agent-harbour-master').map((line) => line.body)).toEqual([
      'Temenggong Abdul Rahman knocks.',
      'You knocks.',
    ])
  })

  it('shows only closed rooms as public knock targets and preserves a listed target through filtering', () => {
    const world = createFixtureWorld()
    const openInput = buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3)
    expect(openInput.knockTargets).toEqual([])
    expect(buildAgentPrompt(openInput).user).toContain('Only valid knock targets: none')

    closeTallyShed(world)
    const input = buildAgentTurnInput(world, 'agent-temenggong', fixtureStageConfig, 3)
    const prompt = buildAgentPrompt(input).user
    expect(input.knockTargets).toEqual([{ id: 'room-tally-shed', name: 'Tally shed' }])
    expect(prompt).toContain('Only valid knock targets: room-tally-shed (Tally shed)')
    expect(prompt).not.toContain('The harbour master')

    const filtered = filterActions(
      [{ type: 'knock', roomId: 'room-tally-shed' }],
      { actorKind: 'agent', actorId: 'agent-temenggong' },
    )
    expect(filtered.dropped).toEqual([])
    expect(filtered.actions).toHaveLength(1)
    expect(applyAction(world, filtered.actions[0]!)).toEqual({ ok: true })
    expect(world.events.at(-1)).toMatchObject({ kind: 'knock', roomId: 'room-tally-shed' })
  })

  it('refuses a knock on the actor\u2019s own room, an unknown room, or an open door', () => {
    const world = createFixtureWorld()
    const ownRoom = applyAction(world, {
      actorKind: 'agent',
      actorId: 'agent-temenggong',
      action: { type: 'knock', roomId: 'room-audience-hall' },
    })
    const unknownRoom = applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: { type: 'knock', roomId: 'room-nowhere' },
    })
    const openDoor = applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: { type: 'knock', roomId: 'room-tally-shed' },
    })

    expect(ownRoom).toEqual({ ok: false, reason: 'cannot knock from inside your own room' })
    expect(unknownRoom).toEqual({ ok: false, reason: 'no such room "room-nowhere"' })
    expect(openDoor).toEqual({ ok: false, reason: 'door to "room-tally-shed" is already open' })
    expect(world.transcript).toEqual([])
    expect(visibleTranscript(world, 'agent-harbour-master')).toEqual([])
    expect(world.events.slice(-3)).toEqual([
      {
        tick: 0,
        actorId: 'agent-temenggong',
        kind: 'refused',
        roomId: 'room-audience-hall',
        detail: 'cannot knock from inside your own room',
      },
      {
        tick: 0,
        actorId: 'player',
        kind: 'refused',
        roomId: 'room-nowhere',
        detail: 'no such room "room-nowhere"',
      },
      {
        tick: 0,
        actorId: 'player',
        kind: 'refused',
        roomId: 'room-tally-shed',
        detail: 'door to "room-tally-shed" is already open',
      },
    ])
  })

  it('rejects an empty closed room at seed construction', () => {
    const seed: WorldSeed = {
      rooms: [
        { id: 'room-open', name: 'Open', description: '', doorOpen: true },
        { id: 'room-sealed', name: 'Sealed', description: '', doorOpen: false },
      ],
      actors: [{ id: 'actor', name: 'Actor', publicRole: 'visitor', kind: 'agent' }],
      placement: { actor: 'room-open' },
    }

    expect(validateWorldSeed(seed)).toEqual([
      { roomId: 'room-sealed', detail: 'closed room "room-sealed" has no actor placed inside' },
    ])
    expect(() => createWorld(seed)).toThrow('room-sealed')
  })

  it('accepts a closed room with an occupant at seed construction', () => {
    const seed: WorldSeed = {
      rooms: [{ id: 'room-sealed', name: 'Sealed', description: '', doorOpen: false }],
      actors: [{ id: 'actor', name: 'Actor', publicRole: 'visitor', kind: 'agent' }],
      placement: { actor: 'room-sealed' },
    }

    expect(createWorld(seed).location).toEqual({ actor: 'room-sealed' })
    expect(validateWorldSeed(seed)).toEqual([])
  })

  it('does not put another actor\u2019s evidence-gated option in a character prompt', async () => {
    const world = createFixtureWorld()
    const hiddenOption = {
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
    const client = new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] })

    await runStage(client, world, {
      ...fixtureStageConfig,
      maxTicks: 1,
      decision: {
        catalogue: [...fixtureOptionCatalogue, hiddenOption],
        ledger: new StageDecisions(fixtureStageParticipants),
      },
    })

    expect(client.requests.every((request) => !request.user.includes(hiddenOption.label))).toBe(true)
  })
})

/** Replies keyed by who is being asked, so a run is scripted but the loop still drives it. */
function scriptedClient(script: Record<string, string[]>): FakeLlmClient {
  const seen: Record<string, number> = {}
  const reply = (request: LlmRequest): string => {
    const who = Object.keys(script).find((name) => request.system.startsWith(`You are ${name}`)) ?? ''
    const lines = script[who] ?? []
    const index = Math.min(seen[who] ?? 0, lines.length - 1)
    seen[who] = (seen[who] ?? 0) + 1
    return lines[index] ?? JSON.stringify({ say: '\u2026', actions: [] })
  }
  return new FakeLlmClient({ replies: [reply] })
}

const say = (body: string, actions: unknown[] = []) => JSON.stringify({ say: body, actions })

function steppingClock(times: readonly number[]): () => number {
  let index = 0
  return () => {
    const value = times[Math.min(index, times.length - 1)]
    index += 1
    if (value === undefined) throw new Error('stepping clock needs at least one timestamp')
    return value
  }
}

describe('autonomous tick (K4)', () => {
  it('skips a configured agent that is absent from the world', async () => {
    const world = createFixtureWorld()
    const client = scriptedClient({ 'Temenggong Abdul Rahman': [say('I remain here.')] })
    const config: StageConfig = {
      ...fixtureStageConfig,
      maxTicks: 1,
      agents: {
        'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']!,
        'agent-ghost': {
          privateContext: fixtureTemenggongPrivate,
          relevant: true,
        },
      },
    }

    const { telemetry } = await runStage(client, world, config)

    expect(telemetry.agentsTicked).toEqual(['agent-temenggong'])
    expect(telemetry.agentsSkipped['agent-ghost']).toBe('not_in_world')
    expect(world.transcript.some((line) => line.speakerId === 'agent-temenggong')).toBe(true)
  })

  it('produces an agent-to-agent exchange and a world delta while the player is idle', async () => {
    const world = createFixtureWorld()
    const client = scriptedClient({
      'Temenggong Abdul Rahman': [
        say('Resident, close the door before you name a figure.', [
          { type: 'close_door', roomId: 'room-audience-hall' },
        ]),
        say('Then we understand each other.'),
      ],
      'William Farquhar': [say('As you wish, Temenggong.'), say('I will put it to Raffles.')],
    })

    const { telemetry } = await runStage(client, world, { ...fixtureStageConfig, maxTicks: 2 })

    const hall = world.transcript.filter((line) => line.roomId === 'room-audience-hall')
    const speakers = new Set(hall.map((line) => line.speakerId))
    expect(speakers).toEqual(new Set(['agent-temenggong', 'agent-farquhar']))
    expect(world.transcript.some((line) => line.speakerId === 'player')).toBe(false)
    expect(world.rooms['room-audience-hall']?.doorOpen).toBe(false)
    expect(world.events.some((event) => event.kind === 'close_door')).toBe(true)
    expect(telemetry.ticks).toBe(2)
  })

  it('stops early when every relevant agent yields', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] })
    const { telemetry } = await runStage(client, world, { ...fixtureStageConfig, maxTicks: 5 })
    expect(telemetry.ticks).toBe(1)
    expect(telemetry.stoppedBy).toBe('all_yielded')
    expect(telemetry.totalActions).toBe(0)
  })

  it('flushes a held reply on the next stage tick and counts its tokens', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({
      replies: [say('Initial answer.'), say('Held answer.'), say('Tick one.'), say('Tick two.')],
    })
    const inbox = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 8 })
    const limiter = new ReplyRateLimiter()
    await submitPlayerMessage(
      client,
      world,
      { ...fixtureAgentTurnInput, playerMessage: null },
      { speakerId: 'player', speakerName: 'You', body: 'First question' },
      { inbox, limiter, nowMs: 0 },
    )
    await submitPlayerMessage(
      client,
      world,
      { ...fixtureAgentTurnInput, playerMessage: null },
      { speakerId: 'player-two', speakerName: 'Ann', body: 'Held question' },
      { inbox, limiter, nowMs: 10 },
    )

    const result = await runStage(client, world, {
      ...fixtureStageConfig,
      agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
      maxTicks: 2,
      replies: { inbox, limiter, now: steppingClock([500, 1_100]) },
    })

    expect(result.telemetry.repliesFlushed).toBe(1)
    expect(result.telemetry.heldMessagesAnswered).toBe(1)
    expect(result.telemetry.totalTokens).toBeGreaterThan(0)
    expect(world.transcript.some((line) => line.body === 'Held answer.')).toBe(true)
  })

  it('reports only held-message drops that occurred during this stage', async () => {
    const world = createFixtureWorld()
    const inbox = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 1 })
    inbox.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body: 'Earlier' })
    inbox.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body: 'Earlier overflow' })

    const result = await runStage(new FakeLlmClient({ replies: [say('', [{ type: 'yield' }])] }), world, {
      ...fixtureStageConfig,
      agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
      maxTicks: 1,
      replies: { inbox, limiter: new ReplyRateLimiter(), now: () => 1_000 },
    })

    expect(result.telemetry.heldMessagesDropped).toBe(0)
  })

  it('force-flushes a held reply when the stage closes', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({
      replies: [say('Initial answer.'), say('', [{ type: 'yield' }]), say('Closing answer.')],
    })
    const inbox = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 8 })
    const limiter = new ReplyRateLimiter()
    await submitPlayerMessage(
      client,
      world,
      { ...fixtureAgentTurnInput, playerMessage: null },
      { speakerId: 'player', speakerName: 'You', body: 'First question' },
      { inbox, limiter, nowMs: 0 },
    )
    await submitPlayerMessage(
      client,
      world,
      { ...fixtureAgentTurnInput, playerMessage: null },
      { speakerId: 'player-two', speakerName: 'Ann', body: 'Held question' },
      { inbox, limiter, nowMs: 10 },
    )

    const result = await runStage(client, world, {
      ...fixtureStageConfig,
      agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
      maxTicks: 1,
      replies: { inbox, limiter, now: steppingClock([500]) },
    })

    expect(result.telemetry.repliesFlushed).toBe(1)
    expect(result.telemetry.heldMessagesAnswered).toBe(1)
    expect(world.transcript.some((line) => line.body === 'Closing answer.')).toBe(true)
  })

  it('keeps an unroutable held reply and reports it without stopping the stage', async () => {
    const world = createFixtureWorld()
    const inbox = new ReplyInbox()
    const limiter = new ReplyRateLimiter()
    inbox.add('agent-not-in-stage', {
      speakerId: 'player',
      speakerName: 'You',
      body: 'A question for someone elsewhere',
    })

    const result = await runStage(
      new FakeLlmClient({ replies: [say('', [{ type: 'yield' }])] }),
      world,
      {
        ...fixtureStageConfig,
        maxTicks: 1,
        replies: { inbox, limiter, now: steppingClock([500]) },
      },
    )

    expect(result.telemetry.repliesUnroutable).toBe(1)
    expect(inbox.waitingAgents()).toEqual(['agent-not-in-stage'])
    expect(result.telemetry.stoppedBy).toBe('all_yielded')
  })
})

describe('budget rails (K5)', () => {
  const chatty = () =>
    scriptedClient({
      'Temenggong Abdul Rahman': [say('One.'), say('Two.'), say('Three.'), say('Four.')],
      'William Farquhar': [say('One.'), say('Two.'), say('Three.'), say('Four.')],
      'The harbour master': [say('I should not be here at all.')],
    })

  const config: StageConfig = { ...fixtureStageConfig, maxTicks: 6, budget: { maxActions: 5, maxActionsPerActor: 2 } }

  it('never exceeds the per-actor or stage cap, and reports both', async () => {
    const world = createFixtureWorld()
    const { telemetry } = await runStage(chatty(), world, config)
    for (const [actorId, count] of Object.entries(telemetry.actionsByActor)) {
      expect(count, `${actorId} exceeded its per-stage cap`).toBeLessThanOrEqual(2)
    }
    expect(telemetry.totalActions).toBeLessThanOrEqual(5)
    expect(telemetry.totalTokens).toBeGreaterThan(0)
  })

  it('never calls an agent the stage does not concern (FR-12b)', async () => {
    const world = createFixtureWorld()
    const client = chatty()
    const { telemetry } = await runStage(client, world, config)
    expect(telemetry.agentsTicked).toEqual(['agent-temenggong', 'agent-farquhar'])
    expect(telemetry.agentsSkipped['agent-harbour-master']).toBe('not_stage_relevant')
    expect(client.requests.some((request) => request.system.includes('harbour master'))).toBe(false)
  })

  it('skips the call entirely once an agent is out of budget', async () => {
    const world = createFixtureWorld()
    const client = chatty()
    await runStage(client, world, config)
    const perAgentCalls = client.requests.filter((request) =>
      request.system.startsWith('You are Temenggong'),
    ).length
    expect(perAgentCalls).toBeLessThanOrEqual(2)
  })

  it('stops the stage when the token ceiling is reached', async () => {
    const world = createFixtureWorld()
    const client = chatty()
    const { telemetry } = await runStage(client, world, {
      ...fixtureStageConfig,
      maxTicks: 6,
      tokenBudget: 1,
    })
    expect(telemetry.stoppedBy).toBe('token_budget')
    expect(telemetry.agentsTicked).toEqual(['agent-temenggong'])
    expect(client.requests).toHaveLength(1)
  })

  it('never exceeds the stage-wide cap within one agent batch', async () => {
    const world = createFixtureWorld()
    const client = scriptedClient({
      'Temenggong Abdul Rahman': [
        say('One line.', [
          { type: 'record_private_note', note: 'one' },
          { type: 'record_private_note', note: 'two' },
          { type: 'record_private_note', note: 'three' },
        ]),
      ],
    })
    const { telemetry } = await runStage(client, world, {
      ...fixtureStageConfig,
      maxTicks: 1,
      agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
      budget: { maxActions: 3, maxActionsPerActor: 10 },
    })
    expect(telemetry.totalActions).toBe(3)
    expect(telemetry.stoppedBy).toBe('action_budget')
  })

  it('reports budget exhaustion when every remaining agent is out of actions', async () => {
    const world = createFixtureWorld()
    const client = scriptedClient({
      'Temenggong Abdul Rahman': [say('One.'), say('Two.')],
    })
    const { telemetry } = await runStage(client, world, {
      ...fixtureStageConfig,
      maxTicks: 4,
      agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
      budget: { maxActions: 10, maxActionsPerActor: 1 },
    })
    expect(telemetry.stoppedBy).toBe('budget_exhausted')
    expect(telemetry.agentsSkipped).toEqual({})
  })

  it('reports max ticks when configured with no ticks', async () => {
    const world = createFixtureWorld()
    const { telemetry } = await runStage(
      new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] }),
      world,
      { ...fixtureStageConfig, maxTicks: 0 },
    )
    expect(telemetry.stoppedBy).toBe('max_ticks')
    expect(telemetry.ticks).toBe(0)
  })

  it('does not count refusals from before the stage', async () => {
    const world = createFixtureWorld()
    applyAction(world, {
      actorKind: 'player',
      actorId: 'player',
      action: { type: 'move_room', toRoomId: 'room-does-not-exist' },
    })
    const { telemetry } = await runStage(
      new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] }),
      world,
      { ...fixtureStageConfig, maxTicks: 1 },
    )
    expect(telemetry.refusedActions).toBe(0)
  })

  it('ends early when every proposed action is refused', async () => {
    const world = createFixtureWorld()
    const { telemetry } = await runStage(
      scriptedClient({
        'Temenggong Abdul Rahman': [say('', [{ type: 'move_room', toRoomId: 'room-does-not-exist' }])],
      }),
      world,
      {
        ...fixtureStageConfig,
        maxTicks: 5,
        agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
      },
    )
    expect(telemetry.ticks).toBe(1)
    expect(telemetry.stoppedBy).toBe('all_yielded')
    expect(telemetry.refusedActions).toBe(1)
  })

  it('lists an agent only in agentsTicked after it later exhausts its budget', async () => {
    const world = createFixtureWorld()
    const { telemetry } = await runStage(
      scriptedClient({ 'Temenggong Abdul Rahman': [say('One.')] }),
      world,
      {
        ...fixtureStageConfig,
        maxTicks: 3,
        agents: { 'agent-temenggong': fixtureStageConfig.agents['agent-temenggong']! },
        budget: { maxActions: 10, maxActionsPerActor: 1 },
      },
    )
    expect(telemetry.agentsTicked).toEqual(['agent-temenggong'])
    expect(telemetry.agentsSkipped).toEqual({})
  })

  it('gives each agent only its own private context across a whole run (FR-21)', async () => {
    const world = createFixtureWorld()
    const client = chatty()
    await runStage(client, world, config)

    const secretsOf = (context: typeof fixtureTemenggongPrivate) => [
      ...context.motivations,
      ...context.secrets,
      ...context.notes,
    ]
    for (const request of client.requests) {
      const isTemenggong = request.system.startsWith('You are Temenggong')
      const foreign = isTemenggong ? fixtureFarquharPrivate : fixtureTemenggongPrivate
      expect(findLeakedText(request, secretsOf(foreign))).toEqual([])
    }
  })
})
