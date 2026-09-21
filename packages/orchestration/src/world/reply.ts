/**
 * Answering a human (FR-12b, revised 20 Sep).
 *
 * The per-agent action cap exists to stop autonomous characters running up the bill; applied to a
 * turn the player addressed, it makes a character go silent mid-conversation, which reads as a
 * broken game rather than as a rail. So a player-addressed reply is not charged against that cap.
 *
 * Two rails replace it, and they bound different things:
 *
 *   1. **A rate per speaker** (`ReplyRateLimiter`). Keyed by whoever is talking, human or agent
 *      alike — the engine does not distinguish actors, and neither does this. It stops one person
 *      spamming a character, and it is set well above human typing speed, so a player at the
 *      keyboard never meets it.
 *   2. **A coalescing window per character** (`ReplyInbox`). A speaker-keyed rate alone does not
 *      bound cost: five players each under their own limit still make five calls on one character.
 *      So messages arriving inside a character's window are answered *together*, in one call, to
 *      the room — one call per window however many people spoke, and a scene that sounds like a
 *      conversation rather than a serialised queue. A lone player never waits: with nobody else
 *      talking the window is already clear.
 *
 * Neither rail produces silence. Past the inbox bound or the stage token ceiling, the character
 * still answers, from a cheap non-LLM path with a short in-fiction deflection.
 *
 * The limiter and inbox are process-local maps. In a serverless deployment, N instances therefore
 * provide N independent rate limits and windows, and a cold start loses held messages. This PoC
 * exposes those losses through `droppedHeld`; distributed state is deliberately out of scope.
 * `tokensSpent` is supplied by the caller, so the ceiling is only as reliable as its bookkeeping.
 * `runStage` is the reference caller and threads its telemetry total through the reply path.
 */
import { runAgentTurn, type AgentTurnResult } from '../agent/character-agent'
import type { AgentTurnInput } from '../agent/types'
import type { StructuredCallMetrics } from '../llm/structured'
import type { LlmClient } from '../llm/types'
import { hashSeed } from '../rng'
import { applyAction, type WorldState } from './state'

export interface ReplyRateLimit {
  /** Minimum gap between two messages from one speaker. */
  minIntervalMs: number
  /** Messages a speaker may send back-to-back before the interval starts biting. */
  burst: number
}

/**
 * Set well above what a human can reach inside a stage timer: a player typing flat out sends a
 * message every few seconds, so this only bites on scripted traffic, where degrading is correct.
 */
export const DEFAULT_REPLY_RATE_LIMIT: ReplyRateLimit = { minIntervalMs: 1_500, burst: 3 }

/**
 * Per-speaker token bucket: one bucket per actor, human or agent, so nobody's spending can
 * rate-limit anyone else. Anti-spam, not a play resource — it is never shown and never spent.
 */
export class ReplyRateLimiter {
  private readonly allowance = new Map<string, { tokens: number; lastMs: number }>()

  constructor(private readonly limit: ReplyRateLimit = DEFAULT_REPLY_RATE_LIMIT) {}

  /** Take one slot for this speaker, if the rate allows. Never blocks, never waits. */
  take(speakerId: string, nowMs: number): boolean {
    const { minIntervalMs, burst } = this.limit
    const state = this.allowance.get(speakerId) ?? { tokens: burst, lastMs: nowMs }
    const elapsed = Math.max(0, nowMs - state.lastMs)
    const refilled = Math.min(burst, state.tokens + elapsed / minIntervalMs)
    if (refilled < 1) {
      this.allowance.set(speakerId, { tokens: refilled, lastMs: Math.max(state.lastMs, nowMs) })
      return false
    }
    this.allowance.set(speakerId, { tokens: refilled - 1, lastMs: Math.max(state.lastMs, nowMs) })
    return true
  }

  /** Slots this speaker has right now. Diagnostics only — never shown to a player or a model. */
  tokensFor(speakerId: string, nowMs: number): number {
    const state = this.allowance.get(speakerId)
    if (state === undefined) return this.limit.burst
    const elapsed = Math.max(0, nowMs - state.lastMs)
    return Math.min(this.limit.burst, state.tokens + elapsed / this.limit.minIntervalMs)
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

export function deflectionFor(agentName: string, prompt: string, attempt = 0): string {
  const line =
    DEFLECTIONS[hashSeed(`${agentName}|${prompt}|${attempt}`) % DEFLECTIONS.length] ?? DEFLECTIONS[0]
  return `${agentName} ${line}`
}

/** One thing a human said to a character, waiting to be answered. */
export interface PendingMessage {
  speakerId: string
  speakerName: string
  body: string
}

export interface CoalescingWindow {
  /** How long a character's answers are batched for. Short: it is latency for a second speaker. */
  windowMs: number
  /** Messages one character will quote back at once. Past it, only the first and newest remain. */
  maxPerAgent: number
}

export const DEFAULT_COALESCING_WINDOW: CoalescingWindow = { windowMs: 1_000, maxPerAgent: 8 }

/**
 * Messages waiting on a character whose window is still open, and the window itself.
 *
 * This is what keeps cost off the player count: however many people speak inside a window, the
 * character answers once. It is not a cap on anyone — nothing is refused here, only batched — and
 * a character with a clear window answers immediately, which is the single-player case.
 */
export class ReplyInbox {
  private readonly waiting = new Map<string, PendingMessage[]>()
  private readonly lastAnsweredMs = new Map<string, number>()
  private readonly dropped = new Map<string, number>()
  private readonly deflections = new Map<string, number>()

  constructor(private readonly window: CoalescingWindow = DEFAULT_COALESCING_WINDOW) {}

  /** May this character answer now, or is it still inside the window of its last reply? */
  isClear(agentId: string, nowMs: number): boolean {
    const last = this.lastAnsweredMs.get(agentId)
    return last === undefined || Math.max(0, nowMs - last) >= this.window.windowMs
  }

  add(agentId: string, message: PendingMessage): void {
    const queue = this.waiting.get(agentId) ?? []
    queue.push(message)
    const max = this.window.maxPerAgent
    if (queue.length > max) {
      const first = queue[0]
      this.dropped.set(agentId, (this.dropped.get(agentId) ?? 0) + queue.length - max)
      if (max <= 1) {
        this.waiting.set(agentId, first === undefined ? [] : [first])
      } else {
        this.waiting.set(agentId, first === undefined ? [] : [first, ...queue.slice(-(max - 1))])
      }
    } else {
      this.waiting.set(agentId, queue)
    }
  }

  /** Take everything waiting on this character and open a new window. Answered in one reply. */
  drain(agentId: string, nowMs: number): PendingMessage[] {
    const queue = this.waiting.get(agentId) ?? []
    this.waiting.delete(agentId)
    this.lastAnsweredMs.set(agentId, nowMs)
    return queue
  }

  lastAnsweredAt(agentId: string): number | undefined {
    return this.lastAnsweredMs.get(agentId)
  }

  restore(agentId: string, messages: readonly PendingMessage[], previousLastAnsweredMs: number | undefined): void {
    const waiting = this.waiting.get(agentId) ?? []
    this.waiting.set(agentId, [...messages, ...waiting])
    if (previousLastAnsweredMs === undefined) this.lastAnsweredMs.delete(agentId)
    else this.lastAnsweredMs.set(agentId, previousLastAnsweredMs)
  }

  pendingFor(agentId: string): readonly PendingMessage[] {
    return this.waiting.get(agentId) ?? []
  }

  /** Characters people are waiting on. */
  waitingAgents(): string[] {
    return [...this.waiting.keys()]
  }

  /** Characters people are waiting on whose window has closed: the turn loop answers these. */
  dueAgents(nowMs: number): string[] {
    return this.waitingAgents().filter((agentId) => this.isClear(agentId, nowMs))
  }

  /** Number of held messages discarded due to the per-character bound. */
  droppedHeld(agentId?: string): number {
    if (agentId !== undefined) return this.dropped.get(agentId) ?? 0
    return [...this.dropped.values()].reduce((total, count) => total + count, 0)
  }

  /** Return and advance the deterministic deflection sequence for one character. */
  nextDeflection(agentId: string): number {
    const attempt = this.deflections.get(agentId) ?? 0
    this.deflections.set(agentId, attempt + 1)
    return attempt
  }
}

export type ReplyMode = 'full' | 'brief' | 'cheap' | 'deflect'

export const REPLY_DEGRADE_AT = { brief: 0.8, cheap: 0.95 } as const

export function replyMode(tokenBudget: number | undefined, tokensSpent: number | undefined): ReplyMode {
  if (tokenBudget === undefined) return 'full'
  if (tokenBudget <= 0) return 'deflect'
  const ratio = (tokensSpent ?? 0) / tokenBudget
  if (ratio >= 1) return 'deflect'
  if (ratio >= REPLY_DEGRADE_AT.cheap) return 'cheap'
  if (ratio >= REPLY_DEGRADE_AT.brief) return 'brief'
  return 'full'
}

export interface ReplyOptions {
  limiter: ReplyRateLimiter
  inbox: ReplyInbox
  /** Who is speaking. The rate is theirs, whether they are a human or another character. */
  speakerId?: string
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
  mode: ReplyMode
  /** Why it was degraded, when it was. Server-side telemetry (FR-24), never sent to a client. */
  degradedBy?: 'rate_limit' | 'token_budget' | 'malformed_reply'
}

function deflect(
  input: AgentTurnInput,
  degradedBy: 'rate_limit' | 'token_budget' | 'malformed_reply',
  mode: ReplyMode,
  attempt: number,
  addresseeId: string | null,
  usage: AgentTurnResult['usage'] = { promptTokens: 0, completionTokens: 0 },
): ReplyResult {
  const say = deflectionFor(input.self.name, input.playerMessage ?? '', attempt)
  return {
    source: 'deflection',
    mode,
    degradedBy,
    turn: {
      agentId: input.self.id,
      say,
      actions: [
        {
          actorKind: 'agent',
          actorId: input.self.id,
          action: { type: 'speak', roomId: input.room.id, body: say, addresseeId },
        },
      ],
      dropped: [],
      degraded: false,
      repairRounds: 0,
      usage,
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
  const mode = replyMode(options.tokenBudget, options.tokensSpent)

  if (mode !== 'deflect' && !options.limiter.take(options.speakerId ?? 'player', options.nowMs)) {
    return deflect(
      input,
      'rate_limit',
      mode,
      options.inbox.nextDeflection(input.self.id),
      options.speakerId ?? null,
    )
  }
  return answerNow(client, world, input, options, mode)
}

export interface CoalescingOptions extends ReplyOptions {
  force?: boolean
}

export type SubmitResult =
  | { status: 'answered'; reply: ReplyResult; answered: readonly PendingMessage[] }
  /**
   * Held: either the speaker is over their rate, or the character is mid-window. Either way the
   * message is answered on the next flush, together with whatever else arrives before then.
   */
  | { status: 'held'; waiting: number; heldBy: 'speaker_rate' | 'coalescing_window' }

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
 * Someone speaks to a character. Answered straight away when the speaker is within their rate and
 * the character's window is clear — and that answer covers everyone who spoke since its last one,
 * in a single call. Otherwise the message is held for `flushReplies`, which is a delay, never a
 * refusal: nothing said to a character goes unanswered.
 *
 * A lone player never waits, since neither rail is ever met with one speaker in a clear window.
 */
export async function submitPlayerMessage(
  client: LlmClient,
  world: WorldState,
  input: AgentTurnInput,
  message: PendingMessage,
  options: CoalescingOptions,
): Promise<SubmitResult> {
  const agentId = input.self.id
  const mode = replyMode(options.tokenBudget, options.tokensSpent)

  const hold = (heldBy: 'speaker_rate' | 'coalescing_window'): SubmitResult => {
    options.inbox.add(agentId, message)
    return { status: 'held', waiting: options.inbox.pendingFor(agentId).length, heldBy }
  }

  if (mode !== 'deflect') {
    // The speaker's own rate is checked first: spamming should cost the spammer's slots, not the
    // character's window, so one person hammering cannot also delay the people around them.
    if (!options.limiter.take(message.speakerId, options.nowMs)) return hold('speaker_rate')
    if (!options.inbox.isClear(agentId, options.nowMs)) return hold('coalescing_window')
  }

  const previousLastAnsweredMs = options.inbox.lastAnsweredAt(agentId)
  const answered = [...options.inbox.drain(agentId, options.nowMs), message]
  try {
    const reply = await answerNow(client, world, withMessages(input, answered), options, mode)
    return { status: 'answered', reply, answered }
  } catch (error) {
    options.inbox.restore(agentId, answered, previousLastAnsweredMs)
    throw error
  }
}

/**
 * Answer the characters people are waiting on whose window has closed — one call each, however
 * many are waiting on them. Called by the turn loop on a tick. Characters still mid-window keep
 * their messages rather than being answered cheaply: a held message becomes part of a real reply a
 * moment later, which is better than a deflection now.
 */
export async function flushReplies(
  client: LlmClient,
  world: WorldState,
  inputFor: (agentId: string) => AgentTurnInput | null,
  options: CoalescingOptions,
): Promise<{ agentId: string; reply: ReplyResult; answered: readonly PendingMessage[] }[]> {
  const flushed: { agentId: string; reply: ReplyResult; answered: readonly PendingMessage[] }[] = []
  let tokensSpent = options.tokensSpent ?? 0
  const agentIds = options.force
    ? options.inbox.waitingAgents()
    : options.inbox.dueAgents(options.nowMs)
  for (const agentId of agentIds) {
    const input = inputFor(agentId)
    if (input === null) continue
    const previousLastAnsweredMs = options.inbox.lastAnsweredAt(agentId)
    const answered = options.inbox.drain(agentId, options.nowMs)
    if (answered.length === 0) continue
    try {
      const reply = await answerNow(
        client,
        world,
        withMessages(input, answered),
        options,
        replyMode(options.tokenBudget, tokensSpent),
      )
      flushed.push({ agentId, reply, answered })
      tokensSpent += reply.turn.usage.promptTokens + reply.turn.usage.completionTokens
    } catch (error) {
      options.inbox.restore(agentId, answered, previousLastAnsweredMs)
      throw error
    }
  }
  return flushed
}

/** The shared tail of both paths: make the call (or deflect), then put the line in the room. */
async function answerNow(
  client: LlmClient,
  world: WorldState,
  input: AgentTurnInput,
  options: ReplyOptions,
  mode: ReplyMode,
): Promise<ReplyResult> {
  const addresseeId =
    input.addressedBy?.length === 1
      ? input.addressedBy[0]?.speakerId ?? null
      : options.speakerId ?? null
  const result: ReplyResult =
    mode === 'deflect'
      ? deflect(
          input,
          'token_budget',
          mode,
          options.inbox.nextDeflection(input.self.id),
          addresseeId,
        )
      : {
          source: 'model',
          mode,
          turn: await runAgentTurn(client, { ...input, actionsRemaining: 1 }, {
            budget: { maxActions: 2, maxActionsPerActor: 2 },
            ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
            ...(mode === 'cheap' ? { modelTier: 'cheap' as const } : {}),
            ...(mode === 'brief' || mode === 'cheap' ? { brief: true } : {}),
          }),
        }

  if (result.source === 'model' && (result.turn.degraded || result.turn.say.trim() === '')) {
    return deflect(
      input,
      'malformed_reply',
      mode,
      options.inbox.nextDeflection(input.self.id),
      addresseeId,
      result.turn.usage,
    )
  }
  if (result.source === 'model') {
    for (const entry of result.turn.actions) {
      if (entry.action.type !== 'yield') applyAction(world, entry)
    }
  }
  return result
}
