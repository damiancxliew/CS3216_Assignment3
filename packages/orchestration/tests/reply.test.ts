import { describe, expect, it } from 'vitest'

import { compileStage, findPath } from '@adventure/game-core'
import { createFixtureWorld, fixtureAgentTurnInput } from '../src/fixtures'
import type { LlmClient, LlmResponse } from '../src/llm/types'
import { applyAction, advanceSpatialMovement, buildAgentTurnInput, createWorld, hasConversationExchange, moveActorStep, visibleTranscript, type WorldState } from '../src/index'
import { FakeLlmClient } from '../src/llm/fake'
import {
  DEFAULT_REPLY_RATE_LIMIT,
  deflectionFor,
  flushReplies,
  ReplyInbox,
  ReplyRateLimiter,
  replyMode,
  replyToPlayer,
  submitPlayerMessage,
  type ReplyResult,
} from '../src/world/reply'

const reply = (say: string) => JSON.stringify({ say, actions: [] })

const askedInTheHall = { ...fixtureAgentTurnInput, playerMessage: 'Would you sign, if the payment were yearly?' }

function createSpatialReplyWorld(playerId = 'player'): { world: WorldState; input: ReturnType<typeof buildAgentTurnInput> } {
  const compiled = compileStage({
    stageId: 'reply-spatial',
    spawnRoomId: 'yard',
    rooms: [
      { id: 'yard', size: 'medium', enclosure: 'open', doorDefault: null },
      { id: 'hall', size: 'medium', enclosure: 'enclosed', doorDefault: 'open' },
    ],
    placements: [{ id: 'agent', kind: 'actor', roomId: 'hall' }, { id: 'decision', kind: 'decision', roomId: 'yard' }],
  }, 'reply-seed')
  const agentPosition = compiled.placements.find(({ id }) => id === 'agent')!.position
  const world = createWorld({
    rooms: compiled.map.rooms.map((room) => ({ id: room.id, name: room.id, description: room.id, doorOpen: room.enclosure === 'open' || compiled.initialDoors[`door:${room.id}`] === 'open', enclosure: room.enclosure })),
    actors: [
      { id: playerId, name: 'Player', publicRole: 'visitor', kind: 'player' },
      { id: 'agent', name: 'Agent', publicRole: 'keeper', kind: 'agent' },
    ],
    placement: { [playerId]: 'yard', agent: 'hall' },
    spatial: { map: compiled.map, state: { doors: { ...compiled.initialDoors }, actors: { [playerId]: compiled.playerSpawn, agent: agentPosition } } },
  })
  applyAction(world, { actorKind: 'player', actorId: playerId, action: { type: 'move_room', toRoomId: 'hall' } })
  for (let step = 0; step < compiled.map.width * compiled.map.height && world.location[playerId] !== 'hall'; step += 1) advanceSpatialMovement(world)
  const input = buildAgentTurnInput(world, 'agent', { sharedContext: 'context', stageBrief: 'brief', agents: { agent: { relevant: true, privateContext: { agentId: 'agent', motivations: [], secrets: [], knowledgeHorizon: 'now', notes: [] } } } }, 1)
  return { world, input }
}

/** One human keeping up a conversation: a message every few seconds, well inside the rate. */
async function conversation(count: number, gapMs: number): Promise<ReplyResult[]> {
  const world = createFixtureWorld()
  const client = new FakeLlmClient({ replies: [reply('The anchorage is not the Company\u2019s to name a price for.')] })
  const limiter = new ReplyRateLimiter()
  const inbox = new ReplyInbox()
  const results: ReplyResult[] = []
  for (let i = 0; i < count; i += 1) {
    results.push(
      await replyToPlayer(client, world, askedInTheHall, {
        limiter,
        inbox,
        speakerId: 'player-kevin',
        nowMs: i * gapMs,
      }),
    )
  }
  return results
}

describe('spatial causal reply pipeline', () => {
  it('does not complete an exchange for unanswered, malformed, rate-limited, or mismatched replies', async () => {
    const { world, input } = createSpatialReplyWorld()
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body: 'Question', addresseeId: 'agent' } })).toEqual({ ok: true })
    const sourceSeq = world.transcript.at(-1)!.seq
    expect(hasConversationExchange(world, 'player', 'agent')).toBe(false)
    const malformed = new FakeLlmClient({ replies: ['not-json'] })
    const malformedResult = await replyToPlayer(malformed, world, { ...input, playerMessage: null, replyToSeqs: [sourceSeq] }, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 })
    expect(malformedResult.source).toBe('deflection')
    expect(hasConversationExchange(world, 'player', 'agent')).toBe(false)
    const limited = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    limited.take('player', 0)
    const limitedResult = await replyToPlayer(new FakeLlmClient({ replies: [reply('unused')] }), world, { ...input, playerMessage: null, replyToSeqs: [sourceSeq] }, { limiter: limited, inbox: new ReplyInbox(), speakerId: 'player', nowMs: 0 })
    expect(limitedResult.source).toBe('deflection')
    expect(hasConversationExchange(world, 'player', 'agent')).toBe(false)
    const rejected = await submitPlayerMessage(new FakeLlmClient({ replies: [reply('unused')] }), world, input, { speakerId: 'player', speakerName: 'Player', body: 'Question', utteranceSeq: sourceSeq + 99 }, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 })
    expect(rejected).toEqual({ status: 'rejected', reason: 'message_not_heard' })
  })

  it('keeps deferred replies tied to current hearing and refuses stale agent rooms', async () => {
    const first = createSpatialReplyWorld()
    expect(applyAction(first.world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body: 'Delayed?', addresseeId: 'agent' } })).toEqual({ ok: true })
    const firstSeq = first.world.transcript.at(-1)!.seq
    let releaseFirst!: (response: LlmResponse) => void
    const firstClient: LlmClient = { complete: async () => new Promise<LlmResponse>((resolve) => { releaseFirst = resolve }) }
    const firstPending = submitPlayerMessage(firstClient, first.world, first.input, { speakerId: 'player', speakerName: 'Player', body: 'Delayed?', utteranceSeq: firstSeq }, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 })
    expect(releaseFirst).toBeDefined()
    const firstDoor = first.world.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
    for (const step of findPath(first.world.spatial!.map, first.world.spatial!.state.doors, first.world.spatial!.state.actors.player!, firstDoor.outside)!) expect(moveActorStep(first.world, 'player', step)).toEqual({ ok: true })
    releaseFirst({ content: reply('A delayed answer.'), usage: { promptTokens: 1, completionTokens: 1 } })
    await firstPending
    expect(first.world.transcript.at(-1)?.recipientIds).not.toContain('player')
    expect(visibleTranscript(first.world, 'player').map(({ body }) => body)).not.toContain('A delayed answer.')
    expect(hasConversationExchange(first.world, 'player', 'agent')).toBe(false)

    const second = createSpatialReplyWorld()
    expect(applyAction(second.world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body: 'Move now?', addresseeId: 'agent' } })).toEqual({ ok: true })
    const secondSeq = second.world.transcript.at(-1)!.seq
    let releaseSecond!: (response: LlmResponse) => void
    const secondClient: LlmClient = { complete: async () => new Promise<LlmResponse>((resolve) => { releaseSecond = resolve }) }
    const secondPending = submitPlayerMessage(secondClient, second.world, second.input, { speakerId: 'player', speakerName: 'Player', body: 'Move now?', utteranceSeq: secondSeq }, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 })
    expect(releaseSecond).toBeDefined()
    const secondDoor = second.world.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
    for (const step of findPath(second.world.spatial!.map, second.world.spatial!.state.doors, second.world.spatial!.state.actors.agent!, secondDoor.outside)!) expect(moveActorStep(second.world, 'agent', step)).toEqual({ ok: true })
    releaseSecond({ content: reply('A stale answer.'), usage: { promptTokens: 1, completionTokens: 1 } })
    await secondPending
    expect(second.world.transcript.map(({ body }) => body)).not.toContain('A stale answer.')
    expect(hasConversationExchange(second.world, 'player', 'agent')).toBe(false)
  })

  it('coalesces exact recorded requests and supports a differently named player actor', async () => {
    const { world, input } = createSpatialReplyWorld('narrator')
    const client = new FakeLlmClient({ replies: [reply('Prime.'), reply('Both heard.')] })
    const options = { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 }
    expect(applyAction(world, { actorKind: 'player', actorId: 'narrator', action: { type: 'speak', roomId: 'hall', body: 'First', addresseeId: 'agent' } })).toEqual({ ok: true })
    const firstSeq = world.transcript.at(-1)!.seq
    const first = await submitPlayerMessage(client, world, input, { speakerId: 'narrator', speakerName: 'Narrator', body: 'First', utteranceSeq: firstSeq }, options)
    expect(first.status).toBe('answered')
    expect(applyAction(world, { actorKind: 'player', actorId: 'narrator', action: { type: 'speak', roomId: 'hall', body: 'Second', addresseeId: 'agent' } })).toEqual({ ok: true })
    const secondSeq = world.transcript.at(-1)!.seq
    expect(applyAction(world, { actorKind: 'player', actorId: 'narrator', action: { type: 'speak', roomId: 'hall', body: 'Third', addresseeId: 'agent' } })).toEqual({ ok: true })
    const thirdSeq = world.transcript.at(-1)!.seq
    const second = await submitPlayerMessage(client, world, input, { speakerId: 'narrator', speakerName: 'Narrator', body: 'Second', utteranceSeq: secondSeq }, options)
    const third = await submitPlayerMessage(client, world, input, { speakerId: 'narrator', speakerName: 'Narrator', body: 'Third', utteranceSeq: thirdSeq }, options)
    expect(second.status).toBe('held')
    expect(third.status).toBe('held')
    const flushed = await flushReplies(client, world, () => buildAgentTurnInput(world, 'agent', { sharedContext: 'context', stageBrief: 'brief', agents: { agent: { relevant: true, privateContext: { agentId: 'agent', motivations: [], secrets: [], knowledgeHorizon: 'now', notes: [] } } } }, 1), { ...options, nowMs: 1_000 })
    expect(flushed[0]?.answered.map(({ utteranceSeq }) => utteranceSeq)).toEqual([secondSeq, thirdSeq])
    expect(world.transcript.at(-1)?.replyToSeqs).toEqual([secondSeq, thirdSeq])
    expect(hasConversationExchange(world, 'narrator', 'agent')).toBe(true)
  })

  it('requires an explicit heard utterance sequence and preserves same-text causality', async () => {
    const { world, input } = createSpatialReplyWorld()
    const body = 'Will you answer?'
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body, addresseeId: 'agent' } })).toEqual({ ok: true })
    const firstSeq = world.transcript.at(-1)!.seq
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body, addresseeId: 'agent' } })).toEqual({ ok: true })
    const secondSeq = world.transcript.at(-1)!.seq
    const rejected = await submitPlayerMessage(new FakeLlmClient({ replies: [reply('no call')] }), world, input, { speakerId: 'player', speakerName: 'Player', body }, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 })
    expect(rejected).toEqual({ status: 'rejected', reason: 'message_not_heard' })
    const client = new FakeLlmClient({ replies: [reply('I answer the first.'), reply('I answer the second.')] })
    const options = { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 0 }
    const first = await submitPlayerMessage(client, world, input, { speakerId: 'player', speakerName: 'Player', body, utteranceSeq: firstSeq }, options)
    expect(first.status).toBe('answered')
    expect(world.transcript.at(-1)?.replyToSeqs).toEqual([firstSeq])
    const second = await submitPlayerMessage(client, world, { ...input, replyToSeqs: [secondSeq] }, { speakerId: 'player', speakerName: 'Player', body, utteranceSeq: secondSeq }, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), nowMs: 10_000 })
    expect(second.status).toBe('answered')
    expect(world.transcript.at(-1)?.replyToSeqs).toEqual([secondSeq])
  })
})

describe('answering a human (FR-12b, revised)', () => {
  it('answers a whole stage of human-paced conversation with the model', async () => {
    const results = await conversation(20, 4_000)
    expect(results.every((result) => result.source === 'model')).toBe(true)
  })

  it('never falls silent when one speaker exceeds their rate: it degrades to a line', async () => {
    const results = await conversation(12, 0)

    const deflected = results.filter((result) => result.source === 'deflection')
    expect(deflected.length).toBeGreaterThan(0)
    expect(results.every((result) => result.turn.say.trim() !== '')).toBe(true)
    expect(deflected.every((result) => result.degradedBy === 'rate_limit')).toBe(true)
    // Degrading costs nothing: that is what makes it safe to always answer.
    expect(deflected.every((result) => result.turn.usage.completionTokens === 0)).toBe(true)
  })

  it('lets one speaker burst, then holds them to the rate', () => {
    const limiter = new ReplyRateLimiter()
    const sent = [0, 0, 0, 0, 0].map((nowMs) => limiter.take('player-kevin', nowMs))
    expect(sent.filter(Boolean)).toHaveLength(DEFAULT_REPLY_RATE_LIMIT.burst)
  })

  it('refills over time, so a rate-limited speaker comes back', () => {
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    expect(limiter.take('player-kevin', 0)).toBe(true)
    expect(limiter.take('player-kevin', 100)).toBe(false)
    expect(limiter.take('player-kevin', 1_100)).toBe(true)
  })

  it('does not refill a bucket when the clock moves backwards', () => {
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    expect(limiter.take('player-kevin', 1_000)).toBe(true)
    expect(limiter.take('player-kevin', 500)).toBe(false)
    expect(limiter.take('player-kevin', 1_500)).toBe(false)
    expect(limiter.take('player-kevin', 2_000)).toBe(true)
  })

  it('rate-limits the speaker, not the character: one spammer does not mute the room', () => {
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    expect(limiter.take('player-kevin', 0)).toBe(true)
    expect(limiter.take('player-kevin', 0)).toBe(false)
    // Ann is talking to the same character, and is unaffected by Kevin's spending.
    expect(limiter.take('player-ann', 0)).toBe(true)
    // Agents are speakers under the same rule; the engine does not distinguish them.
    expect(limiter.take('agent-farquhar', 0)).toBe(true)
  })

  it('still answers when the stage token ceiling is hit', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('unreachable')] })
    const result = await replyToPlayer(client, world, askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
      tokenBudget: 100,
      tokensSpent: 100,
    })

    expect(result).toMatchObject({ source: 'deflection', degradedBy: 'token_budget' })
    expect(result.turn.say.trim()).not.toBe('')
    expect(client.requests).toEqual([])
  })

  it('uses the brevity rule at 85% of the token budget', async () => {
    const client = new FakeLlmClient({ replies: [reply('One short answer.')] })
    const result = await replyToPlayer(client, createFixtureWorld(), askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
      tokenBudget: 100,
      tokensSpent: 85,
    })

    expect(result.mode).toBe('brief')
    expect(client.requests[0]?.system).toContain('Answer in one short sentence.')
  })

  it('uses the cheap model tier at 96% of the token budget', async () => {
    const client = new FakeLlmClient({ replies: [reply('A short answer.')] })
    const result = await replyToPlayer(client, createFixtureWorld(), askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
      tokenBudget: 100,
      tokensSpent: 96,
    })

    expect(result.mode).toBe('cheap')
    expect(client.requests[0]?.modelTier).toBe('cheap')
  })

  it('deflects without a model call at the token ceiling', async () => {
    const client = new FakeLlmClient({ replies: [reply('unreachable')] })
    const result = await replyToPlayer(client, createFixtureWorld(), askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
      tokenBudget: 100,
      tokensSpent: 100,
    })

    expect(result.mode).toBe('deflect')
    expect(result.turn.say.trim()).not.toBe('')
    expect(client.requests).toHaveLength(0)
  })

  it('is not charged against the agent\u2019s stage action cap', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('I will hear the terms.')] })
    // The agent has nothing left for autonomous ticks; the player asking is still answered.
    const spentOut = { ...askedInTheHall, actionsRemaining: 0 }

    const result = await replyToPlayer(client, world, spentOut, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
    })

    expect(result.source).toBe('model')
    expect(result.turn.say).toBe('I will hear the terms.')
  })

  it('allows one world action alongside an addressed reply and drops the rest', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({
      replies: [
        JSON.stringify({
          say: 'Follow me.',
          actions: [
            { type: 'move_room', toRoomId: 'room-tally-shed' },
            { type: 'open_door', roomId: 'room-audience-hall' },
            { type: 'record_private_note', note: 'The player wants to walk.' },
          ],
        }),
      ],
    })

    const result = await replyToPlayer(client, world, askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
    })

    expect(result.turn.actions.map((entry) => entry.action.type)).toEqual(['speak', 'move_room'])
    expect(result.turn.dropped).toHaveLength(2)
    expect(result.turn.dropped.every((drop) => drop.reason === 'budget_exhausted')).toBe(true)
    expect(world.location['agent-temenggong']).toBe('room-tally-shed')
  })

  it('restores a failed immediate reply so a later flush can answer it', async () => {
    const inbox = new ReplyInbox()
    const message = { speakerId: 'player', speakerName: 'You', body: 'Will you sign?' }
    const throwingClient = { complete: async () => { throw new Error('temporary failure') } }

    await expect(
      submitPlayerMessage(throwingClient, createFixtureWorld(), { ...fixtureAgentTurnInput, playerMessage: null }, message, {
        limiter: new ReplyRateLimiter(),
        inbox,
        nowMs: 0,
      }),
    ).rejects.toThrow('temporary failure')
    expect(inbox.pendingFor('agent-temenggong')).toEqual([message])

    const retry = await flushReplies(
      new FakeLlmClient({ replies: [reply('I will consider it.')] }),
      createFixtureWorld(),
      () => ({ ...fixtureAgentTurnInput, playerMessage: null }),
      { limiter: new ReplyRateLimiter(), inbox, nowMs: 1_000 },
    )
    expect(retry[0]?.answered).toEqual([message])
    expect(inbox.pendingFor('agent-temenggong')).toEqual([])
  })

  it('restores a failed flush batch in front of messages that arrived meanwhile', async () => {
    const inbox = new ReplyInbox()
    const first = { speakerId: 'player', speakerName: 'You', body: 'First' }
    const second = { speakerId: 'player-two', speakerName: 'Ann', body: 'Second' }
    inbox.add('agent-temenggong', first)
    const throwingClient = { complete: async () => { throw new Error('temporary failure') } }
    const input = { ...fixtureAgentTurnInput, playerMessage: null }

    const flushPromise = flushReplies(throwingClient, createFixtureWorld(), () => input, {
      limiter: new ReplyRateLimiter(),
      inbox,
      nowMs: 1_000,
    })
    inbox.add('agent-temenggong', second)
    await expect(flushPromise).rejects.toThrow('temporary failure')
    expect(inbox.pendingFor('agent-temenggong')).toEqual([first, second])
  })

  it('recomputes flush degradation after each reply consumes tokens', async () => {
    const inbox = new ReplyInbox({ windowMs: 0, maxPerAgent: 8 })
    inbox.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body: 'First' })
    inbox.add('agent-farquhar', { speakerId: 'player', speakerName: 'You', body: 'Second' })
    const client = new FakeLlmClient({ replies: [reply('A full answer.')] })
    const inputFor = (agentId: string) =>
      agentId === 'agent-temenggong'
        ? { ...fixtureAgentTurnInput, playerMessage: null }
        : {
            ...fixtureAgentTurnInput,
            self: { ...fixtureAgentTurnInput.self, id: 'agent-farquhar', name: 'William Farquhar' },
            playerMessage: null,
          }

    const flushed = await flushReplies(client, createFixtureWorld(), inputFor, {
      limiter: new ReplyRateLimiter(),
      inbox,
      nowMs: 1_000,
      tokenBudget: 100,
      tokensSpent: 90,
    })

    expect(flushed).toHaveLength(2)
    expect(flushed[0]?.reply.source).toBe('model')
    expect(flushed[1]?.reply).toMatchObject({ source: 'deflection', degradedBy: 'token_budget' })
  })

  it('deflects an unrepairable addressed reply while preserving model usage', async () => {
    const client = { complete: async () => ({ content: 'not json', usage: { promptTokens: 7, completionTokens: 3 } }) }
    const input = {
      ...askedInTheHall,
      addressedBy: [{ speakerId: 'player', speakerName: 'You', body: askedInTheHall.playerMessage ?? '' }],
    }

    const result = await replyToPlayer(client, createFixtureWorld(), input, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
    })

    expect(result).toMatchObject({ source: 'deflection', degradedBy: 'malformed_reply' })
    expect(result.turn.say.trim()).not.toBe('')
    expect(result.turn.usage).toEqual({ promptTokens: 21, completionTokens: 9 })
    expect(result.turn.actions[0]?.action).toMatchObject({ type: 'speak', addresseeId: 'player' })
  })

  it('puts the reply in the room, where presence decides who heard it', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('The river mouth is ours to give or keep.')] })
    await replyToPlayer(client, world, askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox: new ReplyInbox(),
      nowMs: 0,
    })

    expect(world.transcript.map((line) => [line.roomId, line.body])).toEqual([
      ['room-audience-hall', 'The river mouth is ours to give or keep.'],
    ])
  })

  it('answers several people who spoke at once in one call, not one each', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('One at a time. Kevin first.')] })
    const limiter = new ReplyRateLimiter()
    const inbox = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 8 })
    const send = async (speakerId: string, speakerName: string, body: string, nowMs: number) =>
      submitPlayerMessage(client, world, askedInTheHall, { speakerId, speakerName, body }, { limiter, inbox, nowMs })

    // Three different players, each well within their own rate; Kevin opens the window.
    expect(await send('player-kevin', 'Kevin', 'Will you sign?', 0)).toMatchObject({ status: 'answered' })
    expect(await send('player-ann', 'Ann', 'What does the Sultan say?', 10)).toMatchObject({
      status: 'held',
      heldBy: 'coalescing_window',
    })
    expect(await send('player-bo', 'Bo', 'And the anchorage dues?', 20)).toMatchObject({ status: 'held', waiting: 2 })

    const callsBefore = client.requests.length
    const flushed = await flushReplies(client, world, () => askedInTheHall, { limiter, inbox, nowMs: 1_100 })

    // Two people waiting, one model call, one line in the room.
    expect(client.requests.length - callsBefore).toBe(1)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.answered.map((message) => message.speakerName)).toEqual(['Ann', 'Bo'])
    expect(flushed[0]?.reply.source).toBe('model')
  })

  it('holds a spammer on their own rate, and still answers what they said', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('Enough. You have my answer.')] })
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    const inbox = new ReplyInbox({ windowMs: 0, maxPerAgent: 8 })
    const spam = async (i: number) =>
      submitPlayerMessage(
        client,
        world,
        askedInTheHall,
        { speakerId: 'player-kevin', speakerName: 'Kevin', body: `sign it ${i}` },
        { limiter, inbox, nowMs: 0 },
      )

    const results = [await spam(0), await spam(1), await spam(2)]
    expect(results.map((result) => result.status)).toEqual(['answered', 'held', 'held'])
    expect(results.slice(1).every((result) => result.status === 'held' && result.heldBy === 'speaker_rate')).toBe(true)

    // Held is a delay, not a refusal: the flood is answered, once, when the rate lets it through.
    const flushed = await flushReplies(client, world, () => askedInTheHall, { limiter, inbox, nowMs: 2_000 })
    expect(flushed[0]?.answered).toHaveLength(2)
    expect(client.requests).toHaveLength(2)
  })

  it('holds the flush to the stage token ceiling too, so held messages are not a way past it', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('unreachable')] })
    const inbox = new ReplyInbox()
    inbox.add('agent-temenggong', { speakerId: 'player-ann', speakerName: 'Ann', body: 'Will you sign?' })

    const flushed = await flushReplies(client, world, () => askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      inbox,
      nowMs: 5_000,
      tokenBudget: 100,
      tokensSpent: 100,
    })

    expect(flushed[0]?.reply).toMatchObject({ source: 'deflection', degradedBy: 'token_budget' })
    expect(client.requests).toHaveLength(0)
    expect(flushed[0]?.reply.turn.say.trim()).not.toBe('')
  })

  it('puts both speakers to the character and tells it to answer them together', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('Ann, the Sultan says nothing yet. Bo, the dues stand.')] })
    const limiter = new ReplyRateLimiter()
    const inbox = new ReplyInbox()
    inbox.add('agent-temenggong', { speakerId: 'player-ann', speakerName: 'Ann', body: 'What does the Sultan say?' })
    inbox.add('agent-temenggong', { speakerId: 'player-bo', speakerName: 'Bo', body: 'And the anchorage dues?' })

    await flushReplies(client, world, () => askedInTheHall, { limiter, inbox, nowMs: 5_000 })

    const request = client.requests[0]
    expect(request?.user).toContain('Ann: What does the Sultan say?')
    expect(request?.user).toContain('Bo: And the anchorage dues?')
    expect(request?.system).toContain('2 people have just spoken to you at once')
  })

  it('never makes a solo player wait: their rate is their own and the window is clear', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('Ask me again when you have a figure.')] })
    const limiter = new ReplyRateLimiter()
    const inbox = new ReplyInbox()

    const results = []
    for (let i = 0; i < 15; i += 1) {
      results.push(
        await submitPlayerMessage(
          client,
          world,
          askedInTheHall,
          { speakerId: 'player', speakerName: 'You', body: `question ${i}` },
          { limiter, inbox, nowMs: i * 4_000 },
        ),
      )
    }

    expect(results.every((result) => result.status === 'answered')).toBe(true)
    expect(inbox.waitingAgents()).toEqual([])
  })

  it('keeps the first and newest held messages, counting overflow', () => {
    const inbox = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 3 })
    for (const body of ['first', 'second', 'third', 'fourth', 'fifth']) {
      inbox.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body })
    }
    expect(inbox.drain('agent-temenggong', 0).map((message) => message.body)).toEqual([
      'first',
      'fourth',
      'fifth',
    ])
    expect(inbox.droppedHeld()).toBe(2)
  })

  it('keeps the first message when the bound is one or two', () => {
    const one = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 1 })
    for (const body of ['first', 'second', 'third']) {
      one.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body })
    }
    expect(one.drain('agent-temenggong', 0).map((message) => message.body)).toEqual(['first'])
    expect(one.droppedHeld()).toBe(2)

    const two = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 2 })
    for (const body of ['first', 'second', 'third']) {
      two.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body })
    }
    expect(two.drain('agent-temenggong', 0).map((message) => message.body)).toEqual(['first', 'third'])
    expect(two.droppedHeld()).toBe(1)
  })

  it('opens a fresh window per character, so a busy one does not delay a quiet one', () => {
    const inbox = new ReplyInbox({ windowMs: 1_000, maxPerAgent: 8 })
    inbox.drain('agent-temenggong', 0)
    expect(inbox.isClear('agent-temenggong', 500)).toBe(false)
    expect(inbox.isClear('agent-temenggong', -500)).toBe(false)
    expect(inbox.isClear('agent-farquhar', 500)).toBe(true)
    expect(inbox.isClear('agent-temenggong', 1_000)).toBe(true)
  })

  it('deflects the same way for the same scene, so a replay is identical', () => {
    const limiter = () => new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 0 })
    const once = async () =>
      (
        await replyToPlayer(
          new FakeLlmClient({ replies: [reply('unreachable')] }),
          createFixtureWorld(),
          askedInTheHall,
          { limiter: limiter(), inbox: new ReplyInbox(), nowMs: 0 },
        )
      ).turn.say

    return Promise.all([once(), once()]).then(([first, second]) => {
      expect(first).toBe(second)
      expect(first).toContain(fixtureAgentTurnInput.self.name)
    })
  })

  it('varies consecutive deflections while replaying the same sequence', async () => {
    const runSequence = async (): Promise<string[]> => {
      const inbox = new ReplyInbox()
      const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 0 })
      const world = createFixtureWorld()
      const client = new FakeLlmClient({ replies: [reply('unreachable')] })
      const lines: string[] = []
      for (let attempt = 0; attempt < 2; attempt += 1) {
        lines.push(
          (
            await replyToPlayer(client, world, askedInTheHall, {
              limiter,
              inbox,
              nowMs: 0,
            })
          ).turn.say,
        )
      }
      return lines
    }

    const first = await runSequence()
    const second = await runSequence()
    expect(first[0]).not.toBe(first[1])
    expect(first).toEqual(second)
    expect(first[0]).toBe(deflectionFor(askedInTheHall.self.name, askedInTheHall.playerMessage ?? '', 0))
    expect(first[1]).toBe(deflectionFor(askedInTheHall.self.name, askedInTheHall.playerMessage ?? '', 1))
  })

  it('does not add deflections to the world transcript', async () => {
    const world = createFixtureWorld()
    const result = await replyToPlayer(
      new FakeLlmClient({ replies: [reply('unreachable')] }),
      world,
      askedInTheHall,
      {
        limiter: new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 0 }),
        inbox: new ReplyInbox(),
        nowMs: 0,
      },
    )
    expect(world.transcript).toEqual([])
    expect(result.turn.say.trim()).not.toBe('')
  })

  it('classifies token spend at each degradation boundary', () => {
    expect(replyMode(undefined, 100)).toBe('full')
    expect(replyMode(100, 79)).toBe('full')
    expect(replyMode(100, 80)).toBe('brief')
    expect(replyMode(100, 95)).toBe('cheap')
    expect(replyMode(100, 100)).toBe('deflect')
  })
})
