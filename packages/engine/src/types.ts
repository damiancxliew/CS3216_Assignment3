import type { LlmClient, Rng } from '@adventure/orchestration'
import type { Action, GameEvent, PlayerView } from '@adventure/play-contract'

/** What `step` needs from the outside world. Nothing in the engine reads a clock, `Math.random` or the network itself. */
export interface StepDeps {
  llm: LlmClient
  /** Epoch milliseconds. */
  now: number
  rng: Rng
}

export interface StepInput<Spec, State, A = Action> {
  spec: Spec
  state: State
  action: A
}

export interface StepResult<State> {
  state: State
  view: PlayerView
  /** Only the events this step produced, for `attempt_events_v3`. */
  events: GameEvent[]
}

/** The engine interface. The real engine and `@adventure/engine/mock` both implement it. */
export interface Engine<Spec, State, A = Action> {
  createState(spec: Spec, seed: string): State
  step(input: StepInput<Spec, State, A>, deps: StepDeps): Promise<StepResult<State>>
  project(spec: Spec, state: State): PlayerView
}
