import { compileStage, landmarkKindFor, validateCompiledStage } from '@adventure/game-core'
import type { CompiledStage, Point, SpatialState, StageLayoutInput } from '@adventure/game-core'
import { toStageRuntime } from '@adventure/generation/runtime'
import { validateAdventureSpec } from '@adventure/generation/spec'
import type { AdventureSpec, SpecIssue } from '@adventure/generation/spec'
import { createWorld, type WorldState } from '@adventure/orchestration'

export type SpatialCompileResult =
  | { ok: true; spec: AdventureSpec; stages: CompiledStage[] }
  | { ok: false; issues: SpecIssue[] }

function enclosureIssue(stageIndex: number, roomIndex: number): SpecIssue {
  return {
    path: `$.stages.${stageIndex}.rooms.${roomIndex}.enclosure`,
    message: 'spatial compilation requires explicit enclosure: expected "enclosed" or "open"',
  }
}

function stageAt(spec: AdventureSpec, stageIndex: number): AdventureSpec['stages'][number] {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= spec.stages.length) {
    throw new Error(`spec has no stage ${stageIndex}`)
  }
  return spec.stages[stageIndex]!
}

export function toStageLayout(spec: AdventureSpec, stageIndex: number): StageLayoutInput {
  const stage = stageAt(spec, stageIndex)
  const rooms = stage.rooms.map((room, roomIndex) => {
    if (room.enclosure === null) throw new Error(`${enclosureIssue(stageIndex, roomIndex).path}: ${enclosureIssue(stageIndex, roomIndex).message}`)
    return { id: room.id, size: room.size, enclosure: room.enclosure, ...(room.shape && room.shape !== 'rectangle' ? { shape: room.shape } : {}), doorDefault: room.doorDefault }
  })
  stage.agents.forEach((agent, agentIndex) => {
    if (agent.id === 'player') throw new Error(`$.stages.${stageIndex}.agents.${agentIndex}.id: reserved actor id "player"`)
  })
  return {
    stageId: stage.id,
    spawnRoomId: stage.spawnRoomId,
    ...(stage.environment ? { landscape: { layout: stage.environment.layout, water: stage.environment.waterfront }, scenery: { palette: stage.environment.props, density: stage.environment.propDensity } } : {}),
    rooms,
    landmarks: stage.rooms.flatMap((room) => room.landmark ? [{ roomId: room.id, kind: landmarkKindFor(room.landmark.name, room.landmark.description, room.kind) }] : []),
    placements: [
      ...stage.agents.map((agent) => ({ id: agent.id, kind: 'actor' as const, roomId: agent.startRoomId })),
      ...stage.evidence.map((item) => ({ id: item.id, kind: 'evidence' as const, roomId: item.roomId })),
      { id: stage.decision.id, kind: 'decision', roomId: stage.decision.roomId },
    ],
  }
}

export function compileAdventure(value: unknown, layoutSeed: string): SpatialCompileResult {
  const validation = validateAdventureSpec(value)
  if (!validation.ok) return validation
  const enclosureIssues: SpecIssue[] = []
  validation.spec.stages.forEach((stage, stageIndex) => {
    stage.rooms.forEach((room, roomIndex) => {
      if (room.enclosure === null) enclosureIssues.push(enclosureIssue(stageIndex, roomIndex))
    })
  })
  if (enclosureIssues.length > 0) return { ok: false, issues: enclosureIssues }

  const stages: CompiledStage[] = []
  for (let stageIndex = 0; stageIndex < validation.spec.stages.length; stageIndex += 1) {
    try {
      stages.push(compileStage(toStageLayout(validation.spec, stageIndex), layoutSeed))
    } catch (error) {
      return {
        ok: false,
        issues: [{
          path: `$.stages.${stageIndex}`,
          message: error instanceof Error ? error.message : String(error),
        }],
      }
    }
  }
  return { ok: true, spec: validation.spec, stages }
}

export function createSpatialStageWorld(spec: AdventureSpec, stageIndex: number, compiled: CompiledStage): WorldState {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= spec.stages.length) throw new Error(`spec has no stage ${stageIndex}`)
  const stage = spec.stages[stageIndex]!
  if (compiled.map.stageId !== stage.id) throw new Error(`compiled stage id "${compiled.map.stageId}" does not match spec stage "${stage.id}"`)
  const compiledValidation = validateCompiledStage(compiled)
  if (!compiledValidation.valid) throw new Error(`invalid compiled stage: ${compiledValidation.errors.join('; ')}`)
  const runtime = toStageRuntime(spec, stageIndex)
  const placements = new Map(compiled.placements.filter(({ kind }) => kind === 'actor').map(({ id, position }) => [id, position]))
  const expectedAgentIds = runtime.world.actors.filter(({ kind }) => kind === 'agent').map(({ id }) => id)
  const actualAgentIds = [...placements.keys()]
  if (expectedAgentIds.length !== actualAgentIds.length || expectedAgentIds.some((id) => !placements.has(id))) throw new Error('compiled actor placement ids do not match runtime agents')
  const actors: Record<string, Point> = {}
  for (const actor of runtime.world.actors) {
    const position = actor.id === 'player' ? compiled.playerSpawn : placements.get(actor.id)
    if (position === undefined) throw new Error(`compiled stage has no actor placement for "${actor.id}"`)
    actors[actor.id] = { x: position.x, y: position.y }
  }
  const spatial: SpatialState = { doors: { ...compiled.initialDoors }, actors }
  return createWorld({ ...runtime.world, spatial: { map: structuredClone(compiled.map), state: spatial } })
}
