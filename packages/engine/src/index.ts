import type { EngineAction } from './context'
import type { EngineSpec } from './spec'
import type { EngineState } from './state'
import { project } from './project'
import { createState, step } from './step'
import type { Engine } from './types'

export { evaluate, type ConditionScope } from './conditions'
export type { EngineAction, StepContext } from './context'
export * from './errors'
export { project } from './project'
export { PostTurnActionSchema, pendingCheckIds, runPostTurnCheck } from './postTurn'
export * from './spec'
export type { EngineState, PostTurnAction, PendingCheck } from './state'
export { createState, step } from './step'
export { summarise, MAX_ANSWERS, type AttemptEvents } from './summary'
export * from './types'

/** The real engine behind the same interface as `@adventure/engine/mock`. */
export const engine: Engine<EngineSpec, EngineState, EngineAction> = { createState, step, project }
