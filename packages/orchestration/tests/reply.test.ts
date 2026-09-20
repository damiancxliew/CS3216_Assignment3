import { describe, expect, it } from 'vitest'

import { createFixtureWorld, fixtureAgentTurnInput } from '../src/fixtures'
import { FakeLlmClient } from '../src/llm/fake'
import {
  DEFAULT_REPLY_RATE_LIMIT,
  flushReplies,
  ReplyInbox,
  ReplyRateLimiter,
  replyToPlayer,
  submitPlayerMessage,
  type ReplyResult,
} from '../src/world/reply'

const reply = (say: string) => JSON.stringify({ say, actions: [] })

const askedInTheHall = { ...fixtureAgentTurnInput, playerMessage: 'Would you sign, if the payment were yearly?' }

/** One human keeping up a conversation: a message every few seconds, well inside the rate. */
async function conversation(count: number, gapMs: number): Promise<ReplyResult[]> {
  const world = createFixtureWorld()
  const client = new FakeLlmClient({ replies: [reply('The anchorage is not the Company\u2019s to name a price for.')] })
  const limiter = new ReplyRateLimiter()
  const results: ReplyResult[] = []
  for (let i = 0; i < count; i += 1) {
    results.push(await replyToPlayer(client, world, askedInTheHall, { limiter, nowMs: i * gapMs }))
  }
  return results
}

describe('answering a human (FR-12b, revised)', () => {
  it('answers a whole stage of human-paced conversation with the model', async () => {
    const results = await conversation(20, 4_000)
    expect(results.every((result) => result.source === 'model')).toBe(true)
  })

  it('never falls silent when the rate is exceeded: it degrades to a line', async () => {
    const results = await conversation(12, 0)

    const deflected = results.filter((result) => result.source === 'deflection')
    expect(deflected.length).toBeGreaterThan(0)
    expect(results.every((result) => result.turn.say.trim() !== '')).toBe(true)
    expect(deflected.every((result) => result.degradedBy === 'rate_limit')).toBe(true)
    // Degrading costs nothing: that is what makes it safe to always answer.
    expect(deflected.every((result) => result.turn.usage.completionTokens === 0)).toBe(true)
  })

  it('caps spend by how long the stage runs, not by how many humans are asking', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('Ask the Resident what he is authorised to pay.')] })
    const limiter = new ReplyRateLimiter()

    // Four players dogpile the same character within one interval.
    const dogpile = await Promise.all(
      [0, 1, 2, 3].map(async () => replyToPlayer(client, world, askedInTheHall, { limiter, nowMs: 0 })),
    )
    const modelBacked = dogpile.filter((result) => result.source === 'model').length

    expect(modelBacked).toBe(DEFAULT_REPLY_RATE_LIMIT.burst)
    expect(dogpile).toHaveLength(4)
    expect(dogpile.every((result) => result.turn.say.trim() !== '')).toBe(true)
  })

  it('refills over time, so a rate-limited character comes back', async () => {
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    expect(limiter.take('agent-temenggong', 0)).toBe(true)
    expect(limiter.take('agent-temenggong', 100)).toBe(false)
    expect(limiter.take('agent-temenggong', 1_100)).toBe(true)
  })

  it('rate-limits per character, so one busy agent does not mute another', () => {
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    expect(limiter.take('agent-temenggong', 0)).toBe(true)
    expect(limiter.take('agent-temenggong', 0)).toBe(false)
    expect(limiter.take('agent-farquhar', 0)).toBe(true)
  })

  it('still answers when the stage token ceiling is hit', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('unreachable')] })
    const result = await replyToPlayer(client, world, askedInTheHall, {
      limiter: new ReplyRateLimiter(),
      nowMs: 0,
      tokenBudget: 100,
      tokensSpent: 100,
    })

    expect(result).toMatchObject({ source: 'deflection', degradedBy: 'token_budget' })
    expect(result.turn.say.trim()).not.toBe('')
    expect(client.requests).toEqual([])
  })

  it('is not charged against the agent\u2019s stage action cap', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('I will hear the terms.')] })
    // The agent has nothing left for autonomous ticks; the player asking is still answered.
    const spentOut = { ...askedInTheHall, actionsRemaining: 0 }

    const result = await replyToPlayer(client, world, spentOut, {
      limiter: new ReplyRateLimiter(),
      nowMs: 0,
    })

    expect(result.source).toBe('model')
    expect(result.turn.say).toBe('I will hear the terms.')
  })

  it('puts the reply in the room, where presence decides who heard it', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('The river mouth is ours to give or keep.')] })
    await replyToPlayer(client, world, askedInTheHall, { limiter: new ReplyRateLimiter(), nowMs: 0 })

    expect(world.transcript.map((line) => [line.roomId, line.body])).toEqual([
      ['room-audience-hall', 'The river mouth is ours to give or keep.'],
    ])
  })

  it('answers several people who spoke at once in one call, not one each', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('One at a time. Kevin first.')] })
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    const inbox = new ReplyInbox()
    const send = async (speakerId: string, speakerName: string, body: string, nowMs: number) =>
      submitPlayerMessage(client, world, askedInTheHall, { speakerId, speakerName, body }, { limiter, inbox, nowMs })

    // Kevin gets the slot; Ann and Bo arrive while the character is out of rate.
    expect(await send('player-kevin', 'Kevin', 'Will you sign?', 0)).toMatchObject({ status: 'answered' })
    expect(await send('player-ann', 'Ann', 'What does the Sultan say?', 10)).toMatchObject({ status: 'held' })
    expect(await send('player-bo', 'Bo', 'And the anchorage dues?', 20)).toMatchObject({ status: 'held', waiting: 2 })

    const callsBefore = client.requests.length
    const flushed = await flushReplies(client, world, () => askedInTheHall, { limiter, inbox, nowMs: 1_100 })

    // Two people waiting, one model call, one line in the room.
    expect(client.requests.length - callsBefore).toBe(1)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.answered.map((message) => message.speakerName)).toEqual(['Ann', 'Bo'])
    expect(flushed[0]?.reply.source).toBe('model')
  })

  it('puts both speakers to the character and tells it to answer them together', async () => {
    const world = createFixtureWorld()
    const client = new FakeLlmClient({ replies: [reply('Ann, the Sultan says nothing yet. Bo, the dues stand.')] })
    const limiter = new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 1 })
    const inbox = new ReplyInbox()
    inbox.add('agent-temenggong', { speakerId: 'player-ann', speakerName: 'Ann', body: 'What does the Sultan say?' })
    inbox.add('agent-temenggong', { speakerId: 'player-bo', speakerName: 'Bo', body: 'And the anchorage dues?' })

    await flushReplies(client, world, () => askedInTheHall, { limiter, inbox, nowMs: 5_000 })

    const request = client.requests[0]
    expect(request?.user).toContain('Ann: What does the Sultan say?')
    expect(request?.user).toContain('Bo: And the anchorage dues?')
    expect(request?.system).toContain('2 people have just spoken to you at once')
  })

  it('never makes a solo player wait: there is always a slot when nobody else is talking', async () => {
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

  it('drops the oldest held messages rather than growing without bound', () => {
    const inbox = new ReplyInbox(2)
    for (const body of ['first', 'second', 'third']) {
      inbox.add('agent-temenggong', { speakerId: 'player', speakerName: 'You', body })
    }
    expect(inbox.drain('agent-temenggong').map((message) => message.body)).toEqual(['second', 'third'])
  })

  it('deflects the same way for the same scene, so a replay is identical', () => {
    const limiter = () => new ReplyRateLimiter({ minIntervalMs: 1_000, burst: 0 })
    const once = async () =>
      (
        await replyToPlayer(
          new FakeLlmClient({ replies: [reply('unreachable')] }),
          createFixtureWorld(),
          askedInTheHall,
          { limiter: limiter(), nowMs: 0 },
        )
      ).turn.say

    return Promise.all([once(), once()]).then(([first, second]) => {
      expect(first).toBe(second)
      expect(first).toContain(fixtureAgentTurnInput.self.name)
    })
  })
})
