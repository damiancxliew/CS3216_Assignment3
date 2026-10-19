/**
 * What every rule and hook works with during one step. The state is a private copy: rules mutate it freely,
 * and `step` returns it only if the whole step succeeds.
 */
import type { LlmClient, Rng } from '@adventure/orchestration'
import type { Action, GameEvent, MessageView } from '@adventure/play-contract'

import { EngineError } from './errors'
import type { EngineSpec, SpecCharacter, SpecDiscovery, SpecDocument, SpecMoment, SpecStage } from './spec'
import type { EngineState, PostTurnAction } from './state'

export type EngineAction = Action | PostTurnAction

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type EventInput = DistributiveOmit<GameEvent, 'at' | 'stageIndex'>

export interface StepContext {
  readonly spec: EngineSpec
  readonly state: EngineState
  readonly now: number
  readonly rng: Rng
  readonly llm: LlmClient
  readonly action: EngineAction
  readonly events: GameEvent[]
  emit(event: EventInput): void
  say(kind: MessageView['kind'], text: string, extra?: { characterId?: string | null; insertedNoteId?: string | null }): MessageView
  nextId(prefix: string): string
  /** Marks that a rule changed something, so the fixpoint loop runs again. */
  touch(): void
  readonly touched: number
}

export function createContext(spec: EngineSpec, state: EngineState, action: EngineAction, deps: { now: number; rng: Rng; llm: LlmClient }): StepContext {
  const events: GameEvent[] = []
  let touched = 0
  const ctx: StepContext = {
    spec,
    state,
    action,
    events,
    now: deps.now,
    rng: deps.rng,
    llm: deps.llm,
    emit(event) {
      events.push({ ...event, at: deps.now, stageIndex: state.phase === 'briefing' ? null : state.stageIndex } as GameEvent)
    },
    nextId(prefix) {
      state.seq += 1
      return `${prefix}${state.seq}`
    },
    say(kind, text, extra = {}) {
      const message: MessageView = {
        id: ctx.nextId('m'),
        kind,
        characterId: extra.characterId ?? null,
        roomId: state.playerRoomId,
        text,
        insertedNoteId: extra.insertedNoteId ?? null,
        stageIndex: state.phase === 'briefing' ? null : state.stageIndex,
        at: deps.now,
      }
      state.transcript.push(message)
      return message
    },
    touch() {
      touched += 1
    },
    get touched() {
      return touched
    },
  }
  return ctx
}

export function fail(code: ConstructorParameters<typeof EngineError>[0], message: string): never {
  throw new EngineError(code, message)
}

/** Lookups that throw `unknown_id` instead of returning undefined. */
export const lookup = {
  stage(spec: EngineSpec, index: number): SpecStage {
    return spec.stages[index] ?? fail('unknown_id', `no stage ${index}`)
  },
  character(spec: EngineSpec, id: string): SpecCharacter {
    return spec.characters.find((character) => character.id === id) ?? fail('unknown_id', `no character ${id}`)
  },
  discovery(spec: EngineSpec, id: string): SpecDiscovery {
    return spec.discoveries.find((discovery) => discovery.id === id) ?? fail('unknown_id', `no discovery ${id}`)
  },
  document(spec: EngineSpec, id: string): SpecDocument {
    return spec.documents.find((document) => document.id === id) ?? fail('unknown_id', `no document ${id}`)
  },
  moment(spec: EngineSpec, id: string): SpecMoment {
    return spec.definingMoments.find((moment) => moment.id === id) ?? fail('unknown_id', `no defining moment ${id}`)
  },
}

export function currentStage(ctx: { spec: EngineSpec; state: EngineState }): SpecStage {
  return lookup.stage(ctx.spec, ctx.state.stageIndex)
}

export function currentMoment(ctx: { spec: EngineSpec; state: EngineState }): SpecMoment {
  return lookup.moment(ctx.spec, currentStage(ctx).definingMomentId)
}

export function isFinalMoment(spec: EngineSpec, moment: SpecMoment): boolean {
  return spec.stages[spec.stages.length - 1]?.definingMomentId === moment.id
}
