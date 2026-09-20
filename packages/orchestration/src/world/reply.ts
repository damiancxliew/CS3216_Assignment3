/**
 * Answering a human (FR-12b, revised 20 Sep).
 *
 * The per-agent action cap exists to stop autonomous characters running up the bill; applied to a
 * turn the player addressed, it makes a character go silent mid-conversation, which reads as a
 * broken game rather than as a rail. So a player-addressed reply is not charged against that cap.
 *
 * What bounds it instead is a *rate* per agent: at most one model-backed reply every
 * `minIntervalMs`, with a small burst. Cost then scales with how long a stage runs, not with how
 * many humans are in it — a table dogpiling one character cannot multiply the spend, and the stage
 * timer stays the only thing that ends a stage.
 *
 * Crossing the rate limit never produces silence. The character still answers, from a cheap
 * non-LLM path, with a short in-fiction deflection. Degraded, not unavailable.
 */
import { runAgentTurn, type AgentTurnResult } from '../agent/character-agent'
import type { AgentTurnInput } from '../agent/types'
import type { StructuredCallMetrics } from '../llm/structured'
import type { LlmClient } from '../llm/types'
import { hashSeed } from '../rng'
import { applyAction, type WorldState } from './state'

export interface ReplyRateLimit {
  /** Minimum gap between two model-backed replies from one agent. */
  minIntervalMs: number
  /** Replies an agent may make back-to-back before the interval starts biting. */
  burst: number
}

/**
 * Set well above what a human can reach inside a stage timer: a player typing flat out sends a
 * message every few seconds, so this only bites on scripted traffic, where degrading is correct.
 */
export const DEFAULT_REPLY_RATE_LIMIT: ReplyRateLimit = { minIntervalMs: 1_500, burst: 3 }

/**
 * Per-agent token bucket. Shared across every human talking to that agent, which is the point:
 * the cap is on the character's voice, not on any one player's turn, so nobody can be rate-limited
 * out of the game by someone else's spending.
 */
export class ReplyRateLimiter {
  private readonly allowance = new Map<string, { tokens: number; lastMs: number }>()

  constructor(private readonly limit: ReplyRateLimit = DEFAULT_REPLY_RATE_LIMIT) {}

  /** Take one reply slot for this agent, if the rate allows. Never blocks, never waits. */
  take(agentId: string, nowMs: number): boolean {
    const { minIntervalMs, burst } = this.limit
    const state = this.allowance.get(agentId) ?? { tokens: burst, lastMs: nowMs }
    const refilled = Math.min(burst, state.tokens + (nowMs - state.lastMs) / minIntervalMs)
    if (refilled < 1) {
      this.allowance.set(agentId, { tokens: refilled, lastMs: nowMs })
      return false
    }
    this.allowance.set(agentId, { tokens: refilled - 1, lastMs: nowMs })
    return true
  }

  /** Reply slots the agent has right now. Diagnostics only — never shown to a player or a model. */
  tokensFor(agentId: string, nowMs: number): number {
    const state = this.allowance.get(agentId)
    if (state === undefined) return this.limit.burst
    return Math.min(this.limit.burst, state.tokens + (nowMs - state.lastMs) / this.limit.minIntervalMs)
  }
}

/**
 * Lines a character falls back to when it is out of rate or the stage is out of tokens. Chosen by
 * hash rather than at random so a replayed attempt produces the same scene, and phrased so the
 * player reads a character being terse, not a system refusing them.
 */
const DEFLECTIONS = [
  'gives you a long look, and says nothing.',
  'turns back to what they were doing.',
  'lifts a hand: not now.',
  'has said all they mean to say for the moment.',
] as const

export function deflectionFor(agentName: string, prompt: string): string {
  const line = DEFLECTIONS[hashSeed(`${agentName}|${prompt}`) % DEFLECTIONS.length] ?? DEFLECTIONS[0]
  return `${agentName} ${line}`
}

export interface ReplyOptions {
  limiter: ReplyRateLimiter
  /** Server clock, passed in so the path stays testable and deterministic. */
  nowMs: number
  metrics?: StructuredCallMetrics
  /** Stage-wide ceiling, the backstop the rate limit does not replace. */
  tokenBudget?: number
  tokensSpent?: number
}

export interface ReplyResult {
  turn: AgentTurnResult
  /** How the line was produced. `deflection` costs no model call. */
  source: 'model' | 'deflection'
  /** Why it was degraded, when it was. Server-side telemetry (FR-24), never sent to a client. */
  degradedBy?: 'rate_limit' | 'token_budget'
}

function deflect(input: AgentTurnInput, degradedBy: 'rate_limit' | 'token_budget'): ReplyResult {
  const say = deflectionFor(input.self.name, input.playerMessage ?? '')
  return {
    source: 'deflection',
    degradedBy,
    turn: {
      agentId: input.self.id,
      say,
      actions: [
        {
          actorKind: 'agent',
          actorId: input.self.id,
          action: { type: 'speak', roomId: input.room.id, body: say, addresseeId: null },
        },
      ],
      dropped: [],
      degraded: false,
      repairRounds: 0,
      usage: { promptTokens: 0, completionTokens: 0 },
    },
  }
}

/**
 * Answer a player. Always produces a line: a model-backed one while the agent is within its reply
 * rate and the stage is within its token ceiling, a cheap in-fiction deflection otherwise.
 */
export async function replyToPlayer(
  client: LlmClient,
  world: WorldState,
  input: AgentTurnInput,
  options: ReplyOptions,
): Promise<ReplyResult> {
  const overTokenBudget =
    options.tokenBudget !== undefined && (options.tokensSpent ?? 0) >= options.tokenBudget

  const result = overTokenBudget
    ? deflect(input, 'token_budget')
    : !options.limiter.take(input.self.id, options.nowMs)
      ? deflect(input, 'rate_limit')
      : {
          source: 'model' as const,
          // The reply is deliberately not charged against the stage action cap: `actionsRemaining`
          // here is what this one reply may do, not what the agent has left for the stage.
          turn: await runAgentTurn(
            client,
            { ...input, actionsRemaining: 1 },
            options.metrics === undefined ? {} : { metrics: options.metrics },
          ),
        }

  for (const entry of result.turn.actions) {
    if (entry.action.type !== 'yield') applyAction(world, entry)
  }
  return result
}
