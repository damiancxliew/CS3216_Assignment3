export const MAP_SCHEMA_VERSION = 3 as const
export const GENERATOR_VERSION = 'settlement-2' as const
export type Enclosure = 'enclosed' | 'open'

export type Point = { x: number; y: number }
export type Tile = 'grass' | 'path' | 'wall' | 'floor' | 'door'
export type LandmarkKind = 'table' | 'monument' | 'tree' | 'well' | 'stall' | 'dock' | 'hearth' | 'shelf'
export type RoomSize = 'small' | 'medium' | 'large'
export type DoorState = 'open' | 'closed'
export type DoorStates = Readonly<Record<string, DoorState>>
export type ActorPositions = Readonly<Record<string, Point>>

export interface SpatialState {
  doors: DoorStates
  actors: ActorPositions
}

export interface RoomWalkResult {
  state: SpatialState
  status: 'moving' | 'arrived' | 'waiting_for_door' | 'unreachable'
}

export interface PublicActorPosition {
  id: string
  position: Point
}

export interface StageLayoutInput {
  stageId: string
  spawnRoomId: string
  rooms: readonly { id: string; size: RoomSize; enclosure?: Enclosure; doorDefault: DoorState | null }[]
  placements: readonly { id: string; kind: 'actor' | 'evidence' | 'decision'; roomId: string }[]
  /** Optional physical fixtures; omitted by older layout callers. */
  landmarks?: readonly { roomId: string; kind: LandmarkKind }[]
}

export interface MapLandmark {
  roomId: string
  kind: LandmarkKind
  x: number
  y: number
  width: 2
  height: 2
}

export interface MapRoom {
  id: string
  enclosure: Enclosure
  x: number
  y: number
  width: number
  height: number
}

export interface MapDoor {
  id: string
  roomId: string
  position: Point
  inside: Point
  outside: Point
}

export interface StageMap {
  schemaVersion: typeof MAP_SCHEMA_VERSION
  generatorVersion: typeof GENERATOR_VERSION
  id: string
  stageId: string
  seed: string
  width: number
  height: number
  tiles: Tile[][]
  rooms: MapRoom[]
  doors: MapDoor[]
  /** Tile-built fixtures that occupy and block their footprint. Older maps omit this. */
  landmarks?: MapLandmark[]
}

export interface CompiledStage {
  map: StageMap
  playerSpawn: Point
  initialDoors: Record<string, DoorState>
  placements: { id: string; kind: 'actor' | 'evidence' | 'decision'; roomId: string; position: Point }[]
}

export type ValidationResult = { valid: boolean; errors: string[] }
export type Space =
  | { kind: 'outdoor'; locationId?: string }
  | { kind: 'room'; roomId: string }
  | { kind: 'door'; doorId: string }
