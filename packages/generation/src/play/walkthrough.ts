/**
 * Spec-level playthrough — a deterministic stand-in for the game runtime.
 *
 * Until the compiler (I2, Yi Hao) and the Turn API (I3, Kevin/Damian) land, this
 * is how the generation slice proves "the adventure stays playable": walk each
 * stage from spawn, satisfy every objective in dependency order by visiting the
 * room its target lives in, take a decision option whose preconditions are met,
 * follow the branch, and reach an ending. It exercises exactly the structure
 * the compiler and Resolver consume, and nothing they own (no geometry, no LLM).
 */
import type { AdventureSpec, DecisionOption, Stage } from '../spec/v2'

export interface StageWalk {
  stageId: string
  spawnRoomId: string
  roomsVisited: string[]
  objectivesCompleted: string[]
  agentsMet: string[]
  evidenceInspected: string[]
  optionId: string
  optionsAvailable: string[]
}

export interface Walkthrough {
  steps: StageWalk[]
  endingId: string
}

export type Chooser = (stage: Stage, available: DecisionOption[], step: number) => DecisionOption

export const chooseFirst: Chooser = (_stage, available) => available[0]!
export const chooseByStance =
  (stance: DecisionOption['stance']): Chooser =>
  (_stage, available) =>
    available.find((o) => o.stance === stance) ?? available[0]!

/** Objectives in an order that respects `requires` (the validator guarantees acyclicity). */
export function orderObjectives(stage: Stage): Stage['objectives'] {
  const byId = new Map(stage.objectives.map((o) => [o.id, o]))
  const done = new Set<string>()
  const out: Stage['objectives'] = []
  const visit = (id: string) => {
    if (done.has(id)) return
    const objective = byId.get(id)
    if (!objective) throw new Error(`unknown objective ${id}`)
    done.add(id)
    objective.requires.forEach(visit)
    out.push(objective)
  }
  stage.objectives.forEach((o) => visit(o.id))
  return out
}

export function walkStage(stage: Stage, choose: Chooser, step: number): StageWalk {
  const rooms = new Set(stage.rooms.map((r) => r.id))
  const agentRoom = new Map(stage.agents.map((a) => [a.id, a.startRoomId]))
  const evidenceRoom = new Map(stage.evidence.map((e) => [e.id, e.roomId]))
  const visited: string[] = [stage.spawnRoomId]
  const agentsMet: string[] = []
  const evidenceInspected: string[] = []
  const completed: string[] = []

  const goTo = (roomId: string) => {
    if (!rooms.has(roomId)) throw new Error(`stage ${stage.id}: room ${roomId} does not exist`)
    if (visited.at(-1) !== roomId) visited.push(roomId)
  }

  for (const objective of orderObjectives(stage)) {
    const room = agentRoom.get(objective.targetId) ?? evidenceRoom.get(objective.targetId)
    if (!room) throw new Error(`stage ${stage.id}: objective ${objective.id} targets unknown entity ${objective.targetId}`)
    goTo(room)
    if (agentRoom.has(objective.targetId)) agentsMet.push(objective.targetId)
    else evidenceInspected.push(objective.targetId)
    completed.push(objective.id)
  }

  const missing = stage.decision.requires.filter((id) => !completed.includes(id))
  if (missing.length) throw new Error(`stage ${stage.id}: decision requires unmet objectives ${missing.join(', ')}`)
  goTo(stage.decision.roomId)
  const available = stage.decision.options.filter((o) => o.preconditions.every((p) => completed.includes(p)))
  if (available.length === 0) throw new Error(`stage ${stage.id}: no decision option is available after completing every objective`)
  const chosen = choose(stage, available, step)
  if (!available.includes(chosen)) throw new Error(`stage ${stage.id}: chooser picked an unavailable option ${chosen.id}`)

  return {
    stageId: stage.id,
    spawnRoomId: stage.spawnRoomId,
    roomsVisited: visited,
    objectivesCompleted: completed,
    agentsMet,
    evidenceInspected,
    optionId: chosen.id,
    optionsAvailable: available.map((o) => o.id),
  }
}

/** Play from stage 0 to an ending. Throws with a precise message if the spec cannot be completed. */
export function walkthrough(spec: AdventureSpec, choose: Chooser = chooseFirst): Walkthrough {
  const stageById = new Map(spec.stages.map((s) => [s.id, s]))
  const endingIds = new Set(spec.endings.map((e) => e.id))
  const steps: StageWalk[] = []
  let stage: Stage | undefined = spec.stages[0]
  while (stage) {
    if (steps.length > spec.stages.length) throw new Error('walkthrough did not terminate')
    const walk = walkStage(stage, choose, steps.length)
    steps.push(walk)
    const target = stage.decision.options.find((o) => o.id === walk.optionId)!.branchTarget
    if (target.kind === 'ending') {
      if (!endingIds.has(target.endingId)) throw new Error(`unknown ending ${target.endingId}`)
      return { steps, endingId: target.endingId }
    }
    stage = stageById.get(target.stageId)
    if (!stage) throw new Error(`unknown stage ${target.stageId}`)
  }
  throw new Error('spec has no stages')
}

/** Every distinct path through the decision tree, and the ending each reaches. */
export function enumeratePaths(spec: AdventureSpec): Array<{ optionIds: string[]; endingId: string }> {
  const stageById = new Map(spec.stages.map((s) => [s.id, s]))
  const paths: Array<{ optionIds: string[]; endingId: string }> = []
  const dfs = (stage: Stage, trail: string[]) => {
    for (const option of stage.decision.options) {
      const next = [...trail, option.id]
      if (option.branchTarget.kind === 'ending') paths.push({ optionIds: next, endingId: option.branchTarget.endingId })
      else dfs(stageById.get(option.branchTarget.stageId)!, next)
    }
  }
  if (spec.stages[0]) dfs(spec.stages[0], [])
  return paths
}
