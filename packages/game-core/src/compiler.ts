import { identityForMap, randomGenerator } from './identity.js'
import { validateCompiledStage, validateStageLayout, isValidSeed } from './validation.js'
import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type CompiledStage,
  type DoorState,
  type MapDoor,
  type MapRoom,
  type Point,
  type RoomSize,
  type StageLayoutInput,
  type StageMap,
} from './types.js'

const ROOM_DIMENSIONS: Record<RoomSize, number> = { small: 7, medium: 9, large: 11 }

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const current = values[index]!
    values[index] = values[other]!
    values[other] = current
  }
  return values
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function stageInput(value: unknown): StageLayoutInput {
  const raw = value as Record<string, unknown>
  const rooms = (raw.rooms as readonly Record<string, unknown>[]).map((room) => ({
    id: room.id as string,
    size: room.size as RoomSize,
    doorDefault: room.doorDefault as DoorState,
  }))
  const placements = (raw.placements as readonly Record<string, unknown>[]).map((placement) => ({
    id: placement.id as string,
    kind: placement.kind as 'actor' | 'evidence' | 'decision',
    roomId: placement.roomId as string,
  }))
  return {
    stageId: raw.stageId as string,
    spawnRoomId: raw.spawnRoomId as string,
    rooms,
    placements,
  }
}

function tileGrid(width: number, height: number): StageMap['tiles'] {
  const tiles: StageMap['tiles'] = Array.from({ length: height }, () => Array.from({ length: width }, () => 'grass'))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) tiles[y]![x] = 'wall'
    }
  }
  for (let x = 1; x < width - 1; x += 1) tiles[15]![x] = 'path'
  return tiles
}

export function compileStage(value: unknown, seed: string): CompiledStage {
  const layoutResult = validateStageLayout(value)
  const errors = [...layoutResult.errors]
  if (!isValidSeed(seed)) errors.push('seed: expected 1 to 64 ASCII letters, digits, dot, underscore, or hyphen')
  if (errors.length > 0) throw new Error(errors.join('; '))
  const input = stageInput(value)
  const sortedRooms = [...input.rooms].sort(compareIds)
  const layoutRandom = randomGenerator(JSON.stringify([GENERATOR_VERSION, input.stageId, seed, 'layout']))
  const slots = shuffle(Array.from({ length: sortedRooms.length }, (_, index) => index), layoutRandom)
  const width = 4 + Math.ceil(sortedRooms.length / 2) * 14
  const height = 30
  const tiles = tileGrid(width, height)
  const rooms: MapRoom[] = []
  const doors: MapDoor[] = []

  sortedRooms.forEach((room, index) => {
    const slot = slots[index]!
    const column = Math.floor(slot / 2)
    const row = slot % 2
    const roomWidth = ROOM_DIMENSIONS[room.size] + Math.floor(layoutRandom() * 2)
    const roomHeight = ROOM_DIMENSIONS[room.size]
    const x = 2 + column * 14 + Math.floor(layoutRandom() * 2)
    const y = row === 0 ? 2 : height - 3 - roomHeight
    const mapRoom = { id: room.id, x, y, width: roomWidth, height: roomHeight }
    rooms.push(mapRoom)
    for (let roomY = y; roomY < y + roomHeight; roomY += 1) {
      for (let roomX = x; roomX < x + roomWidth; roomX += 1) {
        const perimeter = roomX === x || roomX === x + roomWidth - 1 || roomY === y || roomY === y + roomHeight - 1
        tiles[roomY]![roomX] = perimeter ? 'wall' : 'floor'
      }
    }
    const doorX = x + Math.floor(roomWidth / 2)
    const upper = row === 0
    const position = { x: doorX, y: upper ? y + roomHeight - 1 : y }
    const inside = { x: doorX, y: upper ? y + roomHeight - 2 : y + 1 }
    const outside = { x: doorX, y: upper ? y + roomHeight : y - 1 }
    tiles[position.y]![position.x] = 'door'
    for (let pathY = outside.y; pathY !== 15; pathY += upper ? 1 : -1) {
      if (tiles[pathY]![doorX] === 'grass') tiles[pathY]![doorX] = 'path'
    }
    doors.push({ id: `door:${room.id}`, roomId: room.id, position, inside, outside })
  })
  rooms.sort(compareIds)
  doors.sort(compareIds)

  const doorByRoom = new Map(doors.map((door) => [door.roomId, door]))
  const roomInputById = new Map(input.rooms.map((room) => [room.id, room]))
  const initialDoors: Record<string, DoorState> = {}
  for (const room of rooms) initialDoors[doorByRoom.get(room.id)!.id] = roomInputById.get(room.id)!.doorDefault

  const placements: CompiledStage['placements'] = []
  const sortedPlacements = [...input.placements].sort(compareIds)
  const placementsByRoom = new Map<string, typeof sortedPlacements>()
  for (const placement of sortedPlacements) {
    const existing = placementsByRoom.get(placement.roomId) ?? []
    existing.push(placement)
    placementsByRoom.set(placement.roomId, existing)
  }
  let playerSpawn: Point | undefined
  for (const room of rooms) {
    const door = doorByRoom.get(room.id)!
    const available: Point[] = []
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        const point = { x, y }
        if (pointKey(point) !== pointKey(door.inside)) available.push(point)
      }
    }
    shuffle(available, randomGenerator(JSON.stringify([GENERATOR_VERSION, input.stageId, seed, 'placements', room.id])))
    if (room.id === input.spawnRoomId) playerSpawn = available.shift()!
    for (const placement of placementsByRoom.get(room.id) ?? []) {
      const position = available.shift()
      if (!position) throw new Error(`placements.${placement.id}: room has no available interior tile`)
      placements.push({ id: placement.id, kind: placement.kind, roomId: placement.roomId, position })
    }
  }
  if (!playerSpawn) throw new Error('spawnRoomId: no spawn position')
  placements.sort(compareIds)

  const mapWithoutId: StageMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: 'map-0000000000000000',
    stageId: input.stageId,
    seed,
    width,
    height,
    tiles,
    rooms,
    doors,
  }
  const map: StageMap = { ...mapWithoutId, id: identityForMap(mapWithoutId) }
  const compiled = { map, playerSpawn, initialDoors, placements }
  const compiledValidation = validateCompiledStage(compiled)
  if (!compiledValidation.valid) throw new Error(compiledValidation.errors.join('; '))
  return compiled
}
