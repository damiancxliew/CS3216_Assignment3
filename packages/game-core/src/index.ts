export { closeSpatialDoor, moveActor, projectActorPositions, walkActorTowardRoom } from './actors.js'
export { waterContains } from './landscape.js'
export type { LandscapePlan, WaterBody } from './landscape.js'
export { SCENERY_KINDS, sceneryAt } from './scenery.js'
export type { SceneryKind } from './scenery.js'
export { ROOM_SHAPES, roomContains, roomInterior } from './room-shapes.js'
export type { RoomShape } from './room-shapes.js'
export { compileStage } from './compiler.js'
export { LANDMARK_KINDS, landmarkAt, landmarkCovers, landmarkKindFor } from './landmarks.js'
export { validateCompiledStage, validateStageLayout, validateStageMap } from './validation.js'
export { areInSameRoom, canHearSpeech, canStep, findPath, isInPhysicalInteractionRange, isWalkable, spaceAt } from './spatial.js'
export { MAP_SCHEMA_VERSION, GENERATOR_VERSION } from './types.js'
export type {
  ActorPositions,
  CompiledStage,
  DoorState,
  DoorStates,
  Enclosure,
  MapDoor,
  MapLandmark,
  LandmarkKind,
  MapRoom,
  Point,
  PublicActorPosition,
  RoomSize,
  RoomWalkResult,
  Space,
  SpatialState,
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
      enclosure: room.enclosure,
      ...(room.shape ? { shape: room.shape } : {}),
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
    ...(map.waterBodies ? { waterBodies: map.waterBodies.map(body => ({ ...body })) } : {}),
    ...(map.scenery ? { scenery: map.scenery.map(item => ({ ...item })) } : {}),
    ...(map.landmarks ? { landmarks: map.landmarks.map((landmark) => ({ ...landmark })) } : {}),
  }
}
