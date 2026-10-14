/**
 * The Condition language: data only, evaluated against the state. Shared by reveal conditions, trigger
 * requirements, outcome rules, secret unlocks and story events. Unknown ids evaluate to false rather than
 * throwing, so a bad reference can only close a path, never crash a step; `checkSpec` reports them.
 */
import type { Condition, EngineSpec } from './spec'
import type { EngineState } from './state'

export interface ConditionScope {
  spec: EngineSpec
  state: EngineState
  now: number
}

export function stanceIndex(spec: EngineSpec, characterId: string, stanceId: string | null): number {
  if (stanceId === null) return -1
  return spec.characters.find((character) => character.id === characterId)?.stances.findIndex((stance) => stance.id === stanceId) ?? -1
}

export function evaluate(condition: Condition | undefined, scope: ConditionScope): boolean {
  if (condition === undefined) return true
  const { spec, state } = scope
  if ('all' in condition) return condition.all.every((inner) => evaluate(inner, scope))
  if ('any' in condition) return condition.any.some((inner) => evaluate(inner, scope))
  if ('not' in condition) return !evaluate(condition.not, scope)
  if ('discovered' in condition) return state.discovered.includes(condition.discovered)
  if ('stanceAtLeast' in condition) {
    const { characterId, stanceId } = condition.stanceAtLeast
    const target = stanceIndex(spec, characterId, stanceId)
    const current = stanceIndex(spec, characterId, state.characters[characterId]?.stanceId ?? null)
    return target >= 0 && current >= target
  }
  if ('stanceIs' in condition) {
    const { characterId, stanceId } = condition.stanceIs
    return state.characters[characterId]?.stanceId === stanceId
  }
  if ('notePassed' in condition) {
    const { discoveryId, characterId } = condition.notePassed
    return state.passedOn.some((passed) => passed.discoveryId === discoveryId && passed.characterId === characterId)
  }
  if ('slantConfronted' in condition) return state.confrontedSlants.includes(condition.slantConfronted)
  if ('act' in condition) return state.acts[condition.act.momentId] === condition.act.actId
  if ('outcome' in condition) return state.outcomes[condition.outcome.momentId] === condition.outcome.outcomeId
  if ('inRoom' in condition) return state.playerRoomId === condition.inRoom
  if ('elapsedAtLeast' in condition) {
    return state.stageStartedAt !== null && scope.now - state.stageStartedAt >= condition.elapsedAtLeast * 1000
  }
  return false
}
