/**
 * Drives the real engine in tests: a scripted fake LLM (character replies and post-turn checks), a fake clock,
 * and a `postTurn` helper that runs the check flow the way the API does from `after()`.
 */
import { FakeLlmClient, createRng, type LlmRequest } from '@adventure/orchestration'
import type { PostTurnResult } from '@adventure/orchestration/v3'
import type { Action, GameEvent, PlayerView } from '@adventure/play-contract'

import { createState, runPostTurnCheck, step, type EngineSpec, type EngineState } from '../../src'

export interface CheckScript {
  conveyed?: string[]
  substantive?: boolean
  asserted?: boolean
  flagged?: PostTurnResult['moderation']['category']
}

export class Harness {
  state: EngineState
  view: PlayerView | null = null
  events: GameEvent[] = []
  now = Date.UTC(2026, 9, 14, 2, 0, 0)
  /** The next check result; consumed by `check()`. */
  nextCheck: CheckScript = {}
  replyText = 'A reply.'
  interviewLine: string | null = null
  invalidInterviewLine = false
  readonly llm: FakeLlmClient

  constructor(readonly spec: EngineSpec) {
    this.state = createState(spec, 'seed')
    this.llm = new FakeLlmClient({ replies: [(request: LlmRequest) => this.respond(request)] })
  }

  private respond(request: LlmRequest): string {
    if (request.schemaName === 'v3_character_reply') return JSON.stringify({ reply: this.replyText })
    if (request.schemaName === 'v3_interview_line') {
      if (this.invalidInterviewLine) return '{invalid interview line'
      const counterpoint = request.user.match(/<counterpoint>([\s\S]*?)<\/counterpoint>/)?.[1] ?? 'Thank you for telling me.'
      return JSON.stringify({ line: this.interviewLine ?? counterpoint })
    }
    const script = this.nextCheck
    this.nextCheck = {}
    return JSON.stringify({
      conveyed: script.conveyed ?? [],
      substantive: script.substantive ?? false,
      assertedUndiscovered: script.asserted ?? false,
      assertion: script.asserted ? 'a claim' : null,
      moderation: script.flagged === undefined ? { flagged: false, category: 'none', reason: null } : { flagged: true, category: script.flagged, reason: 'r' },
    })
  }

  advance(ms: number): this {
    this.now += ms
    return this
  }

  async act(action: Action | { type: 'postTurn'; messageId: string; result: PostTurnResult }): Promise<PlayerView> {
    const result = await step({ spec: this.spec, state: this.state, action }, { llm: this.llm, now: this.now, rng: createRng('test') })
    this.state = result.state
    this.view = result.view
    this.events.push(...result.events)
    return result.view
  }

  /** Run and apply every pending post-turn check, as the API does from `after()`. */
  async check(script: CheckScript = {}): Promise<PlayerView> {
    let view = this.view as PlayerView
    for (const pending of [...this.state.pendingChecks]) {
      this.nextCheck = script
      const result = await runPostTurnCheck(this.spec, this.state, pending.messageId, { llm: this.llm })
      view = await this.act({ type: 'postTurn', messageId: pending.messageId, result })
    }
    return view
  }

  /** Say something and apply the scripted check. */
  async say(characterId: string, text: string, script: CheckScript = {}): Promise<PlayerView> {
    await this.act({ type: 'message', characterId, text })
    return this.check(script)
  }

  noteFor(discoveryId: string): string {
    const note = this.state.notes.find((candidate) => candidate.discoveryId === discoveryId)
    if (note === undefined) throw new Error(`no note for ${discoveryId}`)
    return note.id
  }

  eventsOf<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
    return this.events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type)
  }

  /** Briefing → stage 1 opening → playing. */
  async start(): Promise<PlayerView> {
    await this.act({ type: 'continue' })
    return this.act({ type: 'continue' })
  }
}
