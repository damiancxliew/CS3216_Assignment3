import { describe, expect, it } from 'vitest'

import {
  createFixtureWorld,
  fixtureFarquharPrivate,
  fixtureAgentTurnInput,
  fixtureStageConfig,
  fixtureTemenggongPrivate,
} from '../src/fixtures'
import { FakeLlmClient } from '../src/llm/fake'
import type { LlmRequest } from '../src/llm/types'
import { findLeakedText } from '../src/privacy'
import { ReplyInbox, ReplyRateLimiter, submitPlayerMessage } from '../src/world/reply'
import { buildAgentTurnInput, runStage, type StageConfig } from '../src/world/stage-runtime'
import { applyAction, visibleTranscript, type WorldState } from '../src/world/state'

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
    const { telemetry } = await runStage(chatty(), world, {
      ...fixtureStageConfig,
      maxTicks: 6,
      tokenBudget: 1,
    })
    expect(telemetry.stoppedBy).toBe('token_budget')
    expect(telemetry.agentsTicked).toEqual(['agent-temenggong'])
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
