export { compileStage } from './compiler.js'
export { validateCompiledStage, validateStageLayout, validateStageMap } from './validation.js'
export { areInSameRoom, canStep, findPath, isInPhysicalInteractionRange, isWalkable, spaceAt } from './spatial.js'
export { MAP_SCHEMA_VERSION, GENERATOR_VERSION } from './types.js'
export type {
  CompiledStage,
  DoorState,
  DoorStates,
  MapDoor,
  MapRoom,
  Point,
  RoomSize,
  Space,
  StageLayoutInput,
  StageMap,
  Tile,
  ValidationResult,
} from './types.js'

import type { CompiledStage, StageMap } from './types.js'

export function projectMap(value: CompiledStage): StageMap {
  const map = value.map
  return {
    schemaVersion: map.schemaVersion,
    generatorVersion: map.generatorVersion,
    id: map.id,
    stageId: map.stageId,
    seed: map.seed,
    width: map.width,
    height: map.height,
    tiles: map.tiles.map((row) => row.slice()),
    rooms: map.rooms.map((room) => ({
      id: room.id,
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height,
    })),
    doors: map.doors.map((door) => ({
      id: door.id,
      roomId: door.roomId,
      position: { x: door.position.x, y: door.position.y },
      inside: { x: door.inside.x, y: door.inside.y },
      outside: { x: door.outside.x, y: door.outside.y },
    })),
  }
}
