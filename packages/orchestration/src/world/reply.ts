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
 * Crossing the rate limit never produces silence, and it does not build a queue of replies either.
 * Messages that arrive while an agent is out of rate are *coalesced*: when a slot refills, the
 * character answers all of them in one call, to the room. One call per window however many people
 * spoke, and a scene that sounds like a conversation rather than a serialised queue. The cheap
 * in-fiction deflection is the last resort — a genuine flood, or the stage token ceiling.
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

/** One thing a human said to a character, waiting to be answered. */
export interface PendingMessage {
  speakerId: string
  speakerName: string
  body: string
}

/**
 * Messages waiting on a character that is momentarily out of rate. Bounded per agent: past the
 * bound the oldest are dropped, because answering a flood in full is neither affordable nor
 * playable — and a dropped message still gets an answer, it is just not quoted back.
 */
export class ReplyInbox {
  private readonly waiting = new Map<string, PendingMessage[]>()

  constructor(private readonly maxPerAgent = 8) {}

  add(agentId: string, message: PendingMessage): void {
    const queue = this.waiting.get(agentId) ?? []
    queue.push(message)
    this.waiting.set(agentId, queue.slice(-this.maxPerAgent))
  }

  /** Take everything waiting on this agent. The caller answers all of it in one reply. */
  drain(agentId: string): PendingMessage[] {
    const queue = this.waiting.get(agentId) ?? []
    this.waiting.delete(agentId)
    return queue
  }

  pendingFor(agentId: string): readonly PendingMessage[] {
    return this.waiting.get(agentId) ?? []
  }

  /** Agents with someone waiting on them. The turn loop flushes these as rate allows. */
  waitingAgents(): string[] {
    return [...this.waiting.keys()]
  }
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
 * Answer one player now, with no coalescing: a model-backed line while the agent is within its
 * reply rate and the stage within its token ceiling, a cheap in-fiction deflection otherwise.
 * Prefer `submitPlayerMessage` where several humans share a room; this is the single-player path.
 */
export async function replyToPlayer(
  client: LlmClient,
  world: WorldState,
  input: AgentTurnInput,
  options: ReplyOptions,
): Promise<ReplyResult> {
  const overTokenBudget =
    options.tokenBudget !== undefined && (options.tokensSpent ?? 0) >= options.tokenBudget

  if (!overTokenBudget && !options.limiter.take(input.self.id, options.nowMs)) {
    const deflected = deflect(input, 'rate_limit')
    for (const entry of deflected.turn.actions) applyAction(world, entry)
    return deflected
  }
  return answerNow(client, world, input, options, overTokenBudget)
}

export interface CoalescingOptions extends ReplyOptions {
  inbox: ReplyInbox
}

export type SubmitResult =
  | { status: 'answered'; reply: ReplyResult; answered: readonly PendingMessage[] }
  /** Held for the next slot, when it will be answered together with whatever else arrives. */
  | { status: 'held'; waiting: number }

/** Put the waiting messages to the character as one thing to answer, not as a queue to work through. */
function withMessages(input: AgentTurnInput, messages: readonly PendingMessage[]): AgentTurnInput {
  const last = messages[messages.length - 1]
  return {
    ...input,
    addressedBy: messages,
    playerMessage: last?.body ?? input.playerMessage,
  }
}

/**
 * A human speaks to a character. Answered straight away when the agent has a reply slot — and the
 * answer covers everyone who spoke since its last one, in a single call. Otherwise the message is
 * held, and `flushReplies` picks it up when a slot refills.
 *
 * A solo player never waits: with nobody else talking there is always a slot, so coalescing costs
 * latency only in the case it exists for, several people talking at once.
 */
export async function submitPlayerMessage(
  client: LlmClient,
  world: WorldState,
  input: AgentTurnInput,
  message: PendingMessage,
  options: CoalescingOptions,
): Promise<SubmitResult> {
  const agentId = input.self.id
  const overTokenBudget =
    options.tokenBudget !== undefined && (options.tokensSpent ?? 0) >= options.tokenBudget

  if (!overTokenBudget && !options.limiter.take(agentId, options.nowMs)) {
    options.inbox.add(agentId, message)
    return { status: 'held', waiting: options.inbox.pendingFor(agentId).length }
  }

  const answered = [...options.inbox.drain(agentId), message]
  const reply = await answerNow(client, world, withMessages(input, answered), options, overTokenBudget)
  return { status: 'answered', reply, answered }
}

/**
 * Answer the characters people are waiting on, as their rate allows. Called by the turn loop on a
 * tick; agents with no slot yet stay held rather than being answered cheaply, because a held
 * message becomes part of a real reply a moment later.
 */
export async function flushReplies(
  client: LlmClient,
  world: WorldState,
  inputFor: (agentId: string) => AgentTurnInput,
  options: CoalescingOptions,
): Promise<{ agentId: string; reply: ReplyResult; answered: readonly PendingMessage[] }[]> {
  const flushed: { agentId: string; reply: ReplyResult; answered: readonly PendingMessage[] }[] = []
  for (const agentId of options.inbox.waitingAgents()) {
    if (!options.limiter.take(agentId, options.nowMs)) continue
    const answered = options.inbox.drain(agentId)
    if (answered.length === 0) continue
    const reply = await answerNow(client, world, withMessages(inputFor(agentId), answered), options, false)
    flushed.push({ agentId, reply, answered })
  }
  return flushed
}

/** The shared tail of both paths: make the call (or deflect), then put the line in the room. */
async function answerNow(
  client: LlmClient,
  world: WorldState,
  input: AgentTurnInput,
  options: ReplyOptions,
  overTokenBudget: boolean,
): Promise<ReplyResult> {
  const result: ReplyResult = overTokenBudget
    ? deflect(input, 'token_budget')
    : {
        source: 'model',
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
