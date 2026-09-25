import { arrangeScenery, layOutLandscape } from './landscape.js'
import { roomContains, roomInterior, type RoomShape } from './room-shapes.js'
import { identityForMap, randomGenerator } from './identity.js'
import { landmarkCovers } from './landmarks.js'
import { validateCompiledStage, validateStageLayout, isValidSeed } from './validation.js'
import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type CompiledStage,
  type DoorState,
  type MapDoor,
  type MapLandmark,
  type MapRoom,
  type Point,
  type RoomSize,
  type StageLayoutInput,
  type StageMap,
} from './types.js'

const ROOM_DIMENSIONS: Record<RoomSize, number> = { small: 7, medium: 9, large: 11 }
const LAYOUT_RANDOM_VERSION = 'settlement-1'

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
  const rooms = (raw.rooms as readonly Record<string, unknown>[]).map((room) => {
    const enclosure = room.enclosure as 'enclosed' | 'open' | undefined
    const shape = room.shape ? { shape: room.shape as RoomShape } : {}
    return enclosure === undefined
      ? { ...shape, id: room.id as string, size: room.size as RoomSize, doorDefault: room.doorDefault as DoorState | null }
      : { ...shape, id: room.id as string, size: room.size as RoomSize, enclosure, doorDefault: room.doorDefault as DoorState | null }
  })
  const placements = (raw.placements as readonly Record<string, unknown>[]).map((placement) => ({
    id: placement.id as string,
    kind: placement.kind as 'actor' | 'evidence' | 'decision',
    roomId: placement.roomId as string,
  }))
  const landmarks = ((raw.landmarks ?? []) as readonly Record<string, unknown>[]).map((landmark) => ({
    roomId: landmark.roomId as string,
    kind: landmark.kind as MapLandmark['kind'],
  }))
  return {
    stageId: raw.stageId as string,
    spawnRoomId: raw.spawnRoomId as string,
    rooms,
    placements,
    ...(landmarks.length ? { landmarks } : {}),
    ...(raw.landscape ? { landscape: raw.landscape as NonNullable<StageLayoutInput["landscape"]> } : {}),
    ...(raw.scenery ? { scenery: raw.scenery as NonNullable<StageLayoutInput["scenery"]> } : {}),
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
  const layoutRandom = randomGenerator(JSON.stringify([LAYOUT_RANDOM_VERSION, input.stageId, seed, 'layout']))
  const slots = shuffle(Array.from({ length: sortedRooms.length }, (_, index) => index), layoutRandom)
  const width = 4 + Math.ceil(sortedRooms.length / 2) * 14
  const height = input.landscape ? 40 : 30
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
    const enclosure = room.enclosure ?? 'enclosed'
    const mapRoom: MapRoom = { id: room.id, enclosure, x, y, width: roomWidth, height: roomHeight, ...(room.shape ? { shape: room.shape } : {}) }
    rooms.push(mapRoom)
    const doorX = x + Math.floor(roomWidth / 2)
    const upper = row === 0
    const edgeY = upper ? y + roomHeight - 1 : y
    if (enclosure === 'enclosed') {
      for (let roomY = y; roomY < y + roomHeight; roomY += 1) {
        for (let roomX = x; roomX < x + roomWidth; roomX += 1) {
          if (!roomContains(mapRoom, { x: roomX, y: roomY })) continue
          const perimeter = !roomInterior(mapRoom, { x: roomX, y: roomY })
          tiles[roomY]![roomX] = perimeter ? 'wall' : 'floor'
        }
      }
      const position = { x: doorX, y: edgeY }
      const inside = { x: doorX, y: upper ? y + roomHeight - 2 : y + 1 }
      const outside = { x: doorX, y: upper ? y + roomHeight : y - 1 }
      tiles[position.y]![position.x] = 'door'
      for (let pathY = outside.y; pathY !== 15; pathY += upper ? 1 : -1) {
        if (tiles[pathY]![doorX] === 'grass') tiles[pathY]![doorX] = 'path'
      }
      doors.push({ id: `door:${room.id}`, roomId: room.id, position, inside, outside })
    } else {
      tiles[edgeY]![doorX] = 'path'
      for (let pathY = edgeY; pathY !== 15; pathY += upper ? 1 : -1) {
        if (tiles[pathY]![doorX] === 'grass') tiles[pathY]![doorX] = 'path'
      }
    }
  })
  rooms.sort(compareIds)
  doors.sort(compareIds)

  const landmarks: MapLandmark[] = (input.landmarks ?? []).map(({ roomId, kind }) => {
    const room = rooms.find((candidate) => candidate.id === roomId)!
    let position = { x: room.x + room.width - 4, y: room.y + 2 }
    const fits = (p: Point) => [0, 1].every(dy => [0, 1].every(dx => roomInterior(room, { x: p.x + dx, y: p.y + dy }))) && !doors.some(d => d.roomId === room.id && d.inside.x >= p.x && d.inside.x < p.x + 2 && d.inside.y >= p.y && d.inside.y < p.y + 2)
    if (!fits(position)) {
      const candidates: Point[] = []
      for (let yy = room.y + 1; yy < room.y + room.height - 2; yy++) for (let xx = room.x + 1; xx < room.x + room.width - 2; xx++) if (fits({ x: xx, y: yy })) candidates.push({ x: xx, y: yy })
      if (!candidates.length) throw new Error(`landmarks.${roomId}: no safe footprint`)
      position = candidates[0]!
    }
    return { roomId, kind, ...position, width: 2 as const, height: 2 as const }
  }).sort((left, right) => left.roomId.localeCompare(right.roomId))

  const doorByRoom = new Map(doors.map((door) => [door.roomId, door]))
  const roomInputById = new Map(input.rooms.map((room) => [room.id, room]))
  const initialDoors: Record<string, DoorState> = {}
  for (const door of doors) initialDoors[door.id] = roomInputById.get(door.roomId)!.doorDefault as DoorState

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
    const door = doorByRoom.get(room.id)
    const available: Point[] = []
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        const point = { x, y }
        if (roomInterior(room, point) && (!door || pointKey(point) !== pointKey(door.inside)) && !landmarks.some((landmark) => landmarkCovers(landmark, point))) available.push(point)
      }
    }
    shuffle(available, randomGenerator(JSON.stringify([LAYOUT_RANDOM_VERSION, input.stageId, seed, 'placements', room.id])))
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
    ...(landmarks.length ? { landmarks } : {}),
  }
  const reserved = [playerSpawn, ...placements.map(p => p.position), ...doors.flatMap(d => [d.position, d.inside, d.outside])]
  if (input.landscape) layOutLandscape(mapWithoutId, input.landscape, reserved)
  if (input.scenery) {
    const scenery = arrangeScenery(mapWithoutId, input.scenery, reserved)
    if (scenery.length) mapWithoutId.scenery = scenery
  }
  const map: StageMap = { ...mapWithoutId, id: identityForMap(mapWithoutId) }
  const compiled = { map, playerSpawn, initialDoors, placements }
  const compiledValidation = validateCompiledStage(compiled)
  if (!compiledValidation.valid) throw new Error(compiledValidation.errors.join('; '))
  return compiled
}
