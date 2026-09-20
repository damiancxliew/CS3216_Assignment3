import { describe, expect, it } from 'vitest'

import { createFixtureWorld, fixtureAgentTurnInput } from '../src/fixtures'
import { FakeLlmClient } from '../src/llm/fake'
import {
  DEFAULT_REPLY_RATE_LIMIT,
  ReplyRateLimiter,
  replyToPlayer,
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
