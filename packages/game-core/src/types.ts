export const MAP_SCHEMA_VERSION = 2 as const
export const GENERATOR_VERSION = 'settlement-1' as const

export type Point = { x: number; y: number }
export type Tile = 'grass' | 'path' | 'wall' | 'floor' | 'door'
export type RoomSize = 'small' | 'medium' | 'large'
export type DoorState = 'open' | 'closed'
export type DoorStates = Readonly<Record<string, DoorState>>

export interface StageLayoutInput {
  stageId: string
  spawnRoomId: string
  rooms: readonly { id: string; size: RoomSize; doorDefault: DoorState }[]
  placements: readonly { id: string; kind: 'actor' | 'evidence' | 'decision'; roomId: string }[]
}

export interface MapRoom {
  id: string
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
}

export interface CompiledStage {
  map: StageMap
  playerSpawn: Point
  initialDoors: Record<string, DoorState>
  placements: { id: string; kind: 'actor' | 'evidence' | 'decision'; roomId: string; position: Point }[]
}

export type ValidationResult = { valid: boolean; errors: string[] }
export type Space = { kind: 'outdoor' } | { kind: 'room'; roomId: string } | { kind: 'door'; doorId: string }
