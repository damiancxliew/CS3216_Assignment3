import { identityForMap } from './identity.js'
import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type CompiledStage,
  type DoorState,
  type MapDoor,
  type MapRoom,
  type Point,
  type StageMap,
  type Tile,
  type ValidationResult,
} from './types.js'

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SEED_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const TILE_VALUES = new Set<Tile>(['grass', 'path', 'wall', 'floor', 'door'])
const SIZE_VALUES = new Set(['small', 'medium', 'large'])
const DOOR_STATE_VALUES = new Set<DoorState>(['open', 'closed'])
const PLACEMENT_KIND_VALUES = new Set(['actor', 'evidence', 'decision'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === expected.size && actual.every((key) => expected.has(key))
}

function hasRequiredKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function hasOnlyIndexedKeys(value: unknown[]): boolean {
  const keys = Object.keys(value)
  return keys.length === value.length && keys.every((key) => {
    const index = Number(key)
    return Number.isInteger(index) && index >= 0 && index < value.length && String(index) === key
  })
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isPoint(value: unknown): value is Point {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['x', 'y']) &&
    isInteger(value.x) &&
    isInteger(value.y)
  )
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 48 && ID_PATTERN.test(value)
}

function result(errors: string[]): ValidationResult {
  return { valid: errors.length === 0, errors }
}

export function isValidSeed(value: unknown): value is string {
  return typeof value === 'string' && SEED_PATTERN.test(value)
}

export function validateStageLayout(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!isRecord(value)) return result(['layout: expected an object'])
  if (!hasRequiredKeys(value, ['stageId', 'spawnRoomId', 'rooms', 'placements'])) {
    errors.push('layout: missing required field')
    return result(errors)
  }
  if (!isSlug(value.stageId)) errors.push('stageId: expected a slug of at most 48 characters')
  if (!isSlug(value.spawnRoomId)) errors.push('spawnRoomId: expected a room id slug')
  if (!Array.isArray(value.rooms)) {
    errors.push('rooms: expected an array')
  } else if (value.rooms.length < 2 || value.rooms.length > 5) {
    errors.push('rooms: expected 2 to 5 rooms')
  } else if (!hasOnlyIndexedKeys(value.rooms)) {
    errors.push('rooms: expected a dense array')
  }
  if (!Array.isArray(value.placements)) {
    errors.push('placements: expected an array')
  } else if (value.placements.length > 11) {
    errors.push('placements: expected at most 11 placements')
  } else if (!hasOnlyIndexedKeys(value.placements)) {
    errors.push('placements: expected a dense array')
  }
  if (errors.length > 0) return result(errors)

  const rooms = value.rooms as unknown[]
  const placements = value.placements as unknown[]
  const ids = new Set<string>()
  if (typeof value.stageId === 'string') ids.add(value.stageId)
  const roomIds = new Set<string>()
  rooms.forEach((room, index) => {
    if (!isRecord(room) || !hasRequiredKeys(room, ['id', 'size', 'doorDefault'])) {
      errors.push(`rooms[${index}]: missing required fields`)
      return
    }
    if (!isSlug(room.id)) errors.push(`rooms[${index}].id: expected a slug of at most 48 characters`)
    if (typeof room.id === 'string') {
      if (ids.has(room.id)) errors.push(`rooms[${index}].id: duplicate id`)
      ids.add(room.id)
      roomIds.add(room.id)
    }
    if (typeof room.size !== 'string' || !SIZE_VALUES.has(room.size)) {
      errors.push(`rooms[${index}].size: expected small, medium, or large`)
    }
    if (typeof room.doorDefault !== 'string' || !DOOR_STATE_VALUES.has(room.doorDefault as DoorState)) {
      errors.push(`rooms[${index}].doorDefault: expected open or closed`)
    }
  })
  if (typeof value.spawnRoomId === 'string' && !roomIds.has(value.spawnRoomId)) {
    errors.push('spawnRoomId: unknown room id')
  }

  const counts = { actor: 0, evidence: 0, decision: 0 }
  placements.forEach((placement, index) => {
    if (!isRecord(placement) || !hasRequiredKeys(placement, ['id', 'kind', 'roomId'])) {
      errors.push(`placements[${index}]: missing required fields`)
      return
    }
    if (!isSlug(placement.id)) errors.push(`placements[${index}].id: expected a slug of at most 48 characters`)
    if (typeof placement.id === 'string') {
      if (ids.has(placement.id)) errors.push(`placements[${index}].id: duplicate id`)
      ids.add(placement.id)
    }
    if (typeof placement.kind !== 'string' || !PLACEMENT_KIND_VALUES.has(placement.kind)) {
      errors.push(`placements[${index}].kind: expected actor, evidence, or decision`)
    } else {
      counts[placement.kind as keyof typeof counts] += 1
    }
    if (typeof placement.roomId !== 'string' || !roomIds.has(placement.roomId)) {
      errors.push(`placements[${index}].roomId: unknown room id`)
    }
  })
  if (counts.actor > 4) errors.push('placements: expected at most 4 actors')
  if (counts.evidence > 6) errors.push('placements: expected at most 6 evidence items')
  if (counts.decision !== 1) errors.push('placements: expected exactly 1 decision')
  return result(errors)
}

function inBounds(map: StageMap, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height
}

function tileAt(map: StageMap, point: Point): Tile | undefined {
  return map.tiles[point.y]?.[point.x]
}

function rectanglesOverlap(left: MapRoom, right: MapRoom): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  )
}

function roomAt(map: StageMap, point: Point): MapRoom | undefined {
  return map.rooms.find(
    (room) =>
      point.x >= room.x &&
      point.x < room.x + room.width &&
      point.y >= room.y &&
      point.y < room.y + room.height,
  )
}

function expectedRoomTile(room: MapRoom, point: Point, doorPositions: Set<string>): Tile {
  if (doorPositions.has(`${point.x},${point.y}`)) return 'door'
  const perimeter =
    point.x === room.x ||
    point.x === room.x + room.width - 1 ||
    point.y === room.y ||
    point.y === room.y + room.height - 1
  return perimeter ? 'wall' : 'floor'
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function validateDoorGeometry(map: StageMap, room: MapRoom, door: MapDoor, errors: string[]): void {
  if (!isPoint(door.position) || !isPoint(door.inside) || !isPoint(door.outside)) {
    errors.push(`doors.${door.id}: invalid point`)
    return
  }
  if (![door.position, door.inside, door.outside].every((point) => inBounds(map, point))) {
    errors.push(`doors.${door.id}: point out of bounds`)
    return
  }
  const sides = [
    door.position.x === room.x,
    door.position.x === room.x + room.width - 1,
    door.position.y === room.y,
    door.position.y === room.y + room.height - 1,
  ].filter(Boolean).length
  if (sides !== 1) errors.push(`doors.${door.id}: position must be on one room boundary`)
  const onVerticalSide = door.position.x === room.x || door.position.x === room.x + room.width - 1
  const notCorner = onVerticalSide
    ? door.position.y > room.y && door.position.y < room.y + room.height - 1
    : door.position.x > room.x && door.position.x < room.x + room.width - 1
  if (!notCorner) errors.push(`doors.${door.id}: position cannot be a corner`)
  const dxInside = door.inside.x - door.position.x
  const dyInside = door.inside.y - door.position.y
  const dxOutside = door.outside.x - door.position.x
  const dyOutside = door.outside.y - door.position.y
  if (
    Math.abs(dxInside) + Math.abs(dyInside) !== 1 ||
    Math.abs(dxOutside) + Math.abs(dyOutside) !== 1 ||
    dxInside !== -dxOutside ||
    dyInside !== -dyOutside
  ) {
    errors.push(`doors.${door.id}: approaches must be opposite orthogonal neighbors`)
    return
  }
  if (!(
    door.inside.x > room.x &&
    door.inside.x < room.x + room.width - 1 &&
    door.inside.y > room.y &&
    door.inside.y < room.y + room.height - 1
  )) {
    errors.push(`doors.${door.id}: inside approach must be an interior tile`)
  }
  if (roomAt(map, door.outside)) errors.push(`doors.${door.id}: outside approach must be outdoors`)
  if (tileAt(map, door.position) !== 'door') errors.push(`doors.${door.id}: position is not a door tile`)
  if (tileAt(map, door.inside) !== 'floor') errors.push(`doors.${door.id}: inside approach is not floor`)
  if (!['grass', 'path'].includes(tileAt(map, door.outside) ?? '')) {
    errors.push(`doors.${door.id}: outside approach is not outdoor`)
  }
}

function openWalkable(map: StageMap, doorIds: Set<string>, point: Point): boolean {
  const tile = tileAt(map, point)
  if (tile === 'grass' || tile === 'path' || tile === 'floor') return true
  if (tile !== 'door') return false
  return map.doors.some((door) => pointKey(door.position) === pointKey(point) && doorIds.has(door.id))
}

function reachablePoints(map: StageMap): Set<string> {
  const openDoors = new Set(map.doors.map((door) => door.id))
  const starts = map.doors.length > 0 ? [map.doors[0]!.outside] : []
  const visited = new Set<string>()
  const queue = starts.map((point) => ({ x: point.x, y: point.y }))
  for (const point of queue) visited.add(pointKey(point))
  const neighbors = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const offset of neighbors) {
      const next = { x: current.x + offset.x, y: current.y + offset.y }
      const key = pointKey(next)
      if (!inBounds(map, next) || visited.has(key) || !openWalkable(map, openDoors, next)) continue
      visited.add(key)
      queue.push(next)
    }
  }
  return visited
}

function validateMapShape(value: unknown, errors: string[]): value is StageMap {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'generatorVersion', 'id', 'stageId', 'seed', 'width', 'height', 'tiles', 'rooms', 'doors'])) {
    errors.push('map: unexpected or missing fields')
    return false
  }
  if (value.schemaVersion !== MAP_SCHEMA_VERSION) errors.push('map.schemaVersion: unsupported version')
  if (value.generatorVersion !== GENERATOR_VERSION) errors.push('map.generatorVersion: unsupported version')
  if (typeof value.id !== 'string' || !/^map-[0-9a-f]{16}$/.test(value.id)) errors.push('map.id: invalid identity')
  if (!isSlug(value.stageId)) errors.push('map.stageId: invalid id')
  if (!isValidSeed(value.seed)) errors.push('map.seed: invalid seed')
  if (!isInteger(value.width) || value.width < 1 || value.width > 128) errors.push('map.width: invalid bound')
  if (!isInteger(value.height) || value.height < 1 || value.height > 128) errors.push('map.height: invalid bound')
  if (!isInteger(value.width) || !isInteger(value.height) || value.width < 1 || value.width > 128 || value.height < 1 || value.height > 128) return false
  if (!Array.isArray(value.tiles)) errors.push('map.tiles: expected an array')
  else if (value.tiles.length !== value.height) errors.push('map.tiles: height mismatch')
  if (!Array.isArray(value.rooms)) errors.push('map.rooms: expected an array')
  else if (value.rooms.length < 2 || value.rooms.length > 5) errors.push('map.rooms: expected 2 to 5 rooms')
  if (!Array.isArray(value.doors)) errors.push('map.doors: expected an array')
  else if (!Array.isArray(value.rooms) || value.doors.length !== value.rooms.length) errors.push('map.doors: expected one door per room')
  if (errors.length > 0) return false
  const tiles = value.tiles as unknown[]
  const rooms = value.rooms as unknown[]
  const doors = value.doors as unknown[]
  if (!hasOnlyIndexedKeys(tiles) || !hasOnlyIndexedKeys(rooms) || !hasOnlyIndexedKeys(doors)) {
    errors.push('map: expected dense arrays')
  }
  if (errors.length > 0) return false
  for (let y = 0; y < tiles.length; y += 1) {
    const row = tiles[y]
    if (!Array.isArray(row) || row.length !== value.width || !hasOnlyIndexedKeys(row)) {
      errors.push(`map.tiles[${y}]: width mismatch or sparse row`)
      continue
    }
    for (let x = 0; x < row.length; x += 1) {
      if (!TILE_VALUES.has(row[x] as Tile)) errors.push(`map.tiles[${y}][${x}]: invalid tile`)
    }
  }
  return errors.length === 0
}

export function validateStageMap(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!validateMapShape(value, errors)) return result(errors)
  const map = value as StageMap
  const roomIds = new Set<string>()
  for (let index = 0; index < map.rooms.length; index += 1) {
    const room = map.rooms[index]
    if (!isRecord(room) || !hasExactKeys(room, ['id', 'x', 'y', 'width', 'height'])) {
      errors.push(`rooms[${index}]: unexpected or missing fields`)
      continue
    }
    if (!isSlug(room.id)) errors.push(`rooms[${index}].id: invalid id`)
    if (typeof room.id === 'string' && roomIds.has(room.id)) errors.push(`rooms[${index}].id: duplicate id`)
    if (typeof room.id === 'string') roomIds.add(room.id)
    if (![room.x, room.y, room.width, room.height].every(isInteger)) {
      errors.push(`rooms[${index}]: coordinates and dimensions must be integers`)
      continue
    }
    if (room.width < 5 || room.width > 16 || room.height < 5 || room.height > 16) {
      errors.push(`rooms[${index}]: dimensions out of bounds`)
    }
    if (room.x < 1 || room.y < 1 || room.x + room.width > map.width - 1 || room.y + room.height > map.height - 1) {
      errors.push(`rooms[${index}]: outside map border`)
    }
  }
  if (roomIds.has(map.stageId)) errors.push('map.stageId: must be distinct from room ids')
  if (errors.length > 0) return result(errors)
  for (let left = 0; left < map.rooms.length; left += 1) {
    for (let right = left + 1; right < map.rooms.length; right += 1) {
      const first = map.rooms[left]!
      const second = map.rooms[right]!
      if (rectanglesOverlap(first, second)) errors.push('rooms: rectangles overlap')
    }
  }
  const doorIds = new Set<string>()
  const doorByRoom = new Map<string, MapDoor>()
  const doorPositions = new Set<string>()
  for (let index = 0; index < map.doors.length; index += 1) {
    const door = map.doors[index]
    if (!isRecord(door) || !hasExactKeys(door, ['id', 'roomId', 'position', 'inside', 'outside'])) {
      errors.push(`doors[${index}]: unexpected or missing fields`)
      continue
    }
    if (typeof door.id !== 'string' || door.id.length === 0 || door.id.length > 96) errors.push(`doors[${index}].id: invalid id`)
    if (typeof door.id === 'string' && doorIds.has(door.id)) errors.push(`doors[${index}].id: duplicate id`)
    if (typeof door.id === 'string') doorIds.add(door.id)
    if (typeof door.roomId !== 'string' || !roomIds.has(door.roomId)) {
      errors.push(`doors[${index}].roomId: unknown room id`)
      continue
    }
    if (door.id !== `door:${door.roomId}`) errors.push(`doors[${index}].id: must match room-derived door id`)
    if (doorByRoom.has(door.roomId)) errors.push(`doors[${index}].roomId: duplicate room door`)
    else doorByRoom.set(door.roomId, door as MapDoor)
    if (isPoint(door.position)) {
      const positionKey = pointKey(door.position)
      if (doorPositions.has(positionKey)) errors.push(`doors[${index}].position: duplicate position`)
      doorPositions.add(positionKey)
    }
  }
  if (errors.length > 0) return result(errors)
  for (const room of map.rooms) {
    if (!doorByRoom.has(room.id)) errors.push(`rooms.${room.id}: missing door`)
    else validateDoorGeometry(map, room, doorByRoom.get(room.id)!, errors)
  }
  if (errors.length > 0) return result(errors)
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const point = { x, y }
      const tile = tileAt(map, point)
      const boundary = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1
      if (boundary) {
        if (tile !== 'wall') errors.push(`tiles[${y}][${x}]: outer border must be wall`)
        continue
      }
      const room = roomAt(map, point)
      if (room) {
        if (tile !== expectedRoomTile(room, point, doorPositions)) {
          errors.push(`tiles[${y}][${x}]: room geometry mismatch`)
        }
      } else if (!['grass', 'path'].includes(tile ?? '')) {
        errors.push(`tiles[${y}][${x}]: stray non-outdoor tile`)
      }
    }
  }
  const reachable = reachablePoints(map)
  for (const door of map.doors) {
    if (!reachable.has(pointKey(door.outside))) errors.push(`doors.${door.id}: outside approach unreachable`)
    if (!reachable.has(pointKey(door.inside))) errors.push(`doors.${door.id}: inside approach unreachable`)
  }
  for (const room of map.rooms) {
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        if (!reachable.has(`${x},${y}`)) errors.push(`rooms.${room.id}: interior unreachable`)
      }
    }
  }
  if (map.id !== identityForMap(map)) errors.push('map.id: identity mismatch')
  return result(errors)
}

function exactObjectKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys)
}

export function validateCompiledStage(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!exactObjectKeys(value, ['map', 'playerSpawn', 'initialDoors', 'placements'])) {
    return result(['compiled: unexpected or missing fields'])
  }
  const compiled = value as unknown as CompiledStage
  const mapResult = validateStageMap(compiled.map)
  errors.push(...mapResult.errors)
  if (!isPoint(compiled.playerSpawn)) errors.push('playerSpawn: expected an integer point')
  if (!isRecord(compiled.initialDoors)) errors.push('initialDoors: expected an object')
  if (!Array.isArray(compiled.placements)) errors.push('placements: expected an array')
  else if (compiled.placements.length < 1 || compiled.placements.length > 11) errors.push('placements: expected 1 to 11 placements')
  else if (!hasOnlyIndexedKeys(compiled.placements)) errors.push('placements: expected a dense array')
  if (errors.length > 0) return result(errors)

  const doors = compiled.initialDoors
  const doorIds = new Set(compiled.map.doors.map((door) => door.id))
  const initialDoorIds = Object.keys(doors)
  if (initialDoorIds.length !== doorIds.size || initialDoorIds.some((id) => !doorIds.has(id))) {
    errors.push('initialDoors: keys must exactly match map doors')
  }
  for (const doorId of initialDoorIds) {
    if (!DOOR_STATE_VALUES.has(doors[doorId] as DoorState)) errors.push(`initialDoors.${doorId}: invalid state`)
  }
  const placementIds = new Set<string>()
  const occupied = new Set<string>()
  if (isPoint(compiled.playerSpawn)) {
    if (!inBounds(compiled.map, compiled.playerSpawn) || tileAt(compiled.map, compiled.playerSpawn) !== 'floor') errors.push('playerSpawn: must be a room interior')
    const spawnRoom = roomAt(compiled.map, compiled.playerSpawn)
    if (!spawnRoom) errors.push('playerSpawn: must be inside a room')
    if (compiled.map.doors.some((door) => pointKey(door.inside) === pointKey(compiled.playerSpawn))) errors.push('playerSpawn: reserved door approach')
    occupied.add(pointKey(compiled.playerSpawn))
  }
  const counts = { actor: 0, evidence: 0, decision: 0 }
  for (let index = 0; index < compiled.placements.length; index += 1) {
    const placement = compiled.placements[index]
    if (!isRecord(placement) || !hasExactKeys(placement, ['id', 'kind', 'roomId', 'position'])) {
      errors.push(`placements[${index}]: unexpected or missing fields`)
      continue
    }
    if (!isSlug(placement.id)) errors.push(`placements[${index}].id: invalid id`)
    if (typeof placement.id === 'string' && placementIds.has(placement.id)) errors.push(`placements[${index}].id: duplicate id`)
    if (typeof placement.id === 'string') placementIds.add(placement.id)
    if (typeof placement.kind !== 'string' || !PLACEMENT_KIND_VALUES.has(placement.kind)) {
      errors.push(`placements[${index}].kind: invalid kind`)
    } else counts[placement.kind as keyof typeof counts] += 1
    if (typeof placement.roomId !== 'string' || !compiled.map.rooms.some((room) => room.id === placement.roomId)) {
      errors.push(`placements[${index}].roomId: unknown room id`)
    }
    if (!isPoint(placement.position)) {
      errors.push(`placements[${index}].position: expected an integer point`)
      continue
    }
    const room = compiled.map.rooms.find(({ id }) => id === placement.roomId)
    if (!room || placement.position.x <= room.x || placement.position.x >= room.x + room.width - 1 || placement.position.y <= room.y || placement.position.y >= room.y + room.height - 1 || tileAt(compiled.map, placement.position) !== 'floor') {
      errors.push(`placements[${index}].position: must be a room interior`)
    }
    if (compiled.map.doors.some((door) => pointKey(door.inside) === pointKey(placement.position))) errors.push(`placements[${index}].position: reserved door approach`)
    const key = pointKey(placement.position)
    if (occupied.has(key)) errors.push(`placements[${index}].position: occupied`)
    occupied.add(key)
  }
  if (counts.actor > 4) errors.push('placements: too many actors')
  if (counts.evidence > 6) errors.push('placements: too many evidence items')
  if (counts.decision !== 1) errors.push('placements: expected exactly one decision')
  const allIds = new Set([compiled.map.stageId, ...compiled.map.rooms.map((room) => room.id), ...placementIds])
  if (allIds.size !== 1 + compiled.map.rooms.length + placementIds.size) errors.push('compiled: ids must be globally unique')
  const reachable = reachablePoints(compiled.map)
  for (const point of occupied) if (!reachable.has(point)) errors.push(`compiled: occupied point ${point} is unreachable with open doors`)
  return result(errors)
}
