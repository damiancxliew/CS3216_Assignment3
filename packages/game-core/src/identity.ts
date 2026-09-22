import type { StageMap } from './types.js'

function keyCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort(keyCompare)
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

export function hashIdentity(value: string): string {
  let hash = 14695981039346656037n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function mapIdentityPayload(map: StageMap): Omit<StageMap, 'id'> {
  return {
    schemaVersion: map.schemaVersion,
    generatorVersion: map.generatorVersion,
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

export function identityForMap(map: StageMap): string {
  return `map-${hashIdentity(canonicalize(mapIdentityPayload(map)))}`
}

export function seedHash(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function randomGenerator(seed: string): () => number {
  let state = seedHash(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
