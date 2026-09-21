import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settlementFixture } from '../fixtures/settlement.js'
import {
  compileStage,
  findPath,
  isInInteractionRange,
  isWalkable,
  canStep,
  projectMap,
  spaceAt,
  validateCompiledStage,
  validateStageLayout,
  validateStageMap,
} from '../src/index.js'
import { identityForMap } from '../src/identity.js'
import type { CompiledStage, DoorStates, StageLayoutInput, StageMap } from '../src/types.js'

type MutableLayout = {
  stageId: string
  spawnRoomId: string
  rooms: { id: string; size: 'small' | 'medium' | 'large'; doorDefault: 'open' | 'closed' }[]
  placements: { id: string; kind: 'actor' | 'evidence' | 'decision'; roomId: string }[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function pointKey(point: { x: number; y: number }): string {
  return `${point.x},${point.y}`
}

function mutableLayout(value: StageLayoutInput): MutableLayout {
  return clone(value) as MutableLayout
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

function layout(roomCount: number, suffix = ''): StageLayoutInput {
  const sizes = ['small', 'medium', 'large', 'small', 'medium'] as const
  const rooms: MutableLayout['rooms'] = Array.from({ length: roomCount }, (_, index) => ({
    id: `room-${index + 1}${suffix}`,
    size: sizes[index] ?? 'small',
    doorDefault: (index % 2 === 0 ? 'open' : 'closed') as 'open' | 'closed',
  }))
  return {
    stageId: `stage-${roomCount}${suffix}`,
    spawnRoomId: rooms[0]!.id,
    rooms,
    placements: [
      { id: `decision-${roomCount}${suffix}`, kind: 'decision', roomId: rooms[0]!.id },
    ],
  }
}

function validMapWithId(map: StageMap): StageMap {
  const next = clone(map)
  next.id = identityForMap(next)
  return next
}

function firstRoomFloor(compiled: CompiledStage) {
  const room = compiled.map.rooms[0]!
  return { x: room.x + 1, y: room.y + 1 }
}

describe('settlement compiler', () => {
  it('compiles the authored fixture and matches the committed artifact', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const artifact = JSON.parse(
      readFileSync(new URL('../fixtures/settlement.compiled.json', import.meta.url), 'utf8'),
    )
    expect(compiled).toEqual(artifact)
    expect(validateCompiledStage(compiled)).toEqual({ valid: true, errors: [] })
  })

  it.each(Array.from({ length: 20 }, (_, index) => [2 + (index % 4), String(index)] as const))(
    'produces a valid deterministic map for %i rooms and seed %s',
    (roomCount, seed) => {
      const input = layout(roomCount)
      const first = compileStage(input, seed)
      const second = compileStage(input, seed)
      expect(first).toEqual(second)
      expect(JSON.stringify(first)).toBe(JSON.stringify(second))
      expect(validateStageMap(first.map)).toEqual({ valid: true, errors: [] })
      expect(validateCompiledStage(first)).toEqual({ valid: true, errors: [] })
    },
  )

  it.each(['0', '1', '2', '3', '4'])('places the maximum entity count in one small room with the spawn for seed %s', (seed) => {
    const maxInput: StageLayoutInput = {
      stageId: 'maximum-layout',
      spawnRoomId: 'small-room',
      rooms: [
        { id: 'small-room', size: 'small', doorDefault: 'closed' },
        { id: 'large-room', size: 'large', doorDefault: 'open' },
      ],
      placements: [
        ...Array.from({ length: 4 }, (_, index) => ({ id: `actor-${index + 1}`, kind: 'actor' as const, roomId: 'small-room' })),
        ...Array.from({ length: 6 }, (_, index) => ({ id: `evidence-${index + 1}`, kind: 'evidence' as const, roomId: 'small-room' })),
        { id: 'decision', kind: 'decision', roomId: 'small-room' },
      ],
    }
    const compiled = compileStage(maxInput, seed)
    expect(validateCompiledStage(compiled)).toEqual({ valid: true, errors: [] })
    expect(new Set([compiled.playerSpawn, ...compiled.placements.map(({ position }) => position)].map(pointKey)).size).toBe(12)
  })

  it('changes geometry for distinct stage inputs', () => {
    expect(compileStage(layout(2), 'same-seed').map).not.toEqual(
      compileStage(layout(3), 'same-seed').map,
    )
  })

  it('canonicalizes room and placement input ordering', () => {
    const reversed = mutableLayout(settlementFixture)
    reversed.rooms = [...reversed.rooms].reverse()
    reversed.placements = [...reversed.placements].reverse()
    expect(JSON.stringify(compileStage(reversed, 'fixture-seed'))).toBe(
      JSON.stringify(compileStage(settlementFixture, 'fixture-seed')),
    )
  })

  it('ignores unrecognized layout fields and private strings for geometry', () => {
    const withExtras = mutableLayout(settlementFixture) as unknown as {
      privateContext?: string
      rooms: Record<string, unknown>[]
      placements: Record<string, unknown>[]
    }
    withExtras.privateContext = 'secret-a'
    withExtras.rooms = withExtras.rooms.map((room) => ({ ...room, secret: 'secret-a' }))
    withExtras.placements = withExtras.placements.map((placement) => ({
      ...placement,
      content: 'secret-a',
    }))
    const changed = clone(withExtras)
    changed.privateContext = 'secret-b'
    changed.rooms = changed.rooms.map((room) => ({ ...room, secret: 'secret-b' }))
    changed.placements = changed.placements.map((placement) => ({
      ...placement,
      content: 'secret-b',
    }))
    expect(JSON.stringify(compileStage(withExtras, 'fixture-seed'))).toBe(
      JSON.stringify(compileStage(changed, 'fixture-seed')),
    )
  })

  it('keeps geometry identity independent from placements, spawn, and door defaults', () => {
    const changed = mutableLayout(settlementFixture)
    changed.spawnRoomId = 'archive'
    changed.rooms = changed.rooms.map((room) => ({
      ...room,
      doorDefault: room.doorDefault === 'open' ? 'closed' : 'open',
    }))
    changed.placements = changed.placements.map((placement) => ({
      ...placement,
      roomId: placement.roomId === 'market' ? 'archive' : placement.roomId,
    }))
    const first = compileStage(settlementFixture, 'fixture-seed')
    const second = compileStage(changed, 'fixture-seed')
    expect(second.map).toEqual(first.map)
    expect(second.playerSpawn).not.toEqual(first.playerSpawn)
    expect(second.initialDoors).not.toEqual(first.initialDoors)
    expect(second.placements).not.toEqual(first.placements)
    const hiddenEntities = mutableLayout(settlementFixture)
    hiddenEntities.placements = hiddenEntities.placements.filter(({ kind }) => kind === 'decision')
    expect(compileStage(hiddenEntities, 'fixture-seed').map).toEqual(first.map)
  })

  it('changes identity when seed, room size, or room id changes', () => {
    const base = compileStage(layout(3), 'seed-a').map.id
    expect(compileStage(layout(3), 'seed-b').map.id).not.toBe(base)
    expect(compileStage(layout(3, '-changed'), 'seed-a').map.id).not.toBe(base)
    const resized = mutableLayout(layout(3))
    resized.rooms[0] = { ...resized.rooms[0]!, size: 'large' }
    expect(compileStage(resized, 'seed-a').map.id).not.toBe(base)
  })

  it('rejects malformed layouts, duplicates, unknown references, and bad seeds', () => {
    for (const value of [null, [], 'text', 7, { rooms: [] }, { ...layout(2), rooms: 'rooms' }]) {
      expect(() => validateStageLayout(value)).not.toThrow()
      expect(validateStageLayout(value).valid).toBe(false)
    }
    const duplicate = mutableLayout(layout(2))
    duplicate.rooms[1] = { ...duplicate.rooms[0]! }
    expect(validateStageLayout(duplicate).valid).toBe(false)
    const unknown = mutableLayout(layout(2))
    unknown.placements[0] = { ...unknown.placements[0]!, roomId: 'missing-room' }
    expect(validateStageLayout(unknown).valid).toBe(false)
    const oversizedRooms = mutableLayout(layout(2))
    oversizedRooms.rooms = [...oversizedRooms.rooms, ...oversizedRooms.rooms, ...oversizedRooms.rooms]
    expect(validateStageLayout(oversizedRooms).valid).toBe(false)
    const oversizedPlacements = mutableLayout(layout(2))
    oversizedPlacements.placements = Array.from({ length: 12 }, (_, index) => ({
      id: `evidence-${index + 1}`,
      kind: 'evidence' as const,
      roomId: oversizedPlacements.rooms[0]!.id,
    }))
    expect(validateStageLayout(oversizedPlacements).valid).toBe(false)
    expect(validateStageLayout({ ...layout(2), stageId: 'bad id' }).valid).toBe(false)
    expect(() => compileStage(layout(2), 'bad seed!')).toThrow(/seed/)
    expect(() => compileStage(layout(2), '')).toThrow(/seed/)
  })

  it('does not throw on malformed values for any public validator', () => {
    for (const validator of [validateStageLayout, validateStageMap, validateCompiledStage]) {
      for (const value of [null, [], 7]) {
        expect(() => validator(value)).not.toThrow()
        expect(validator(value).valid).toBe(false)
      }
    }
  })

  it('rejects corrupt map geometry independently of compiler regeneration', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const malformed = clone(compiled.map) as unknown as Record<string, unknown>
    malformed.rooms = [null, null]
    expect(() => validateStageMap(malformed)).not.toThrow()
    expect(validateStageMap(malformed).valid).toBe(false)
    const tileCorrupt = clone(compiled.map)
    tileCorrupt.tiles[1]![1] = 'floor'
    expect(validateStageMap(validMapWithId(tileCorrupt))).toEqual(
      expect.objectContaining({ valid: false }),
    )
    const perimeterCorrupt = clone(compiled.map)
    const room = perimeterCorrupt.rooms[0]!
    perimeterCorrupt.tiles[room.y]![room.x] = 'grass'
    expect(validateStageMap(validMapWithId(perimeterCorrupt)).valid).toBe(false)
    const approachCorrupt = clone(compiled.map)
    const door = approachCorrupt.doors[0]!
    approachCorrupt.tiles[door.outside.y]![door.outside.x] = 'wall'
    expect(validateStageMap(validMapWithId(approachCorrupt)).valid).toBe(false)
    const refCorrupt = clone(compiled.map)
    refCorrupt.doors[0]!.roomId = 'missing'
    expect(validateStageMap(validMapWithId(refCorrupt)).valid).toBe(false)
    const overlapCorrupt = clone(compiled.map)
    overlapCorrupt.rooms[1] = { ...overlapCorrupt.rooms[0]!, id: 'overlap-room' }
    expect(validateStageMap(validMapWithId(overlapCorrupt)).valid).toBe(false)
  })

  it('rejects sparse arrays and bounds oversized inputs before iteration', () => {
    const sparseRooms = mutableLayout(layout(2))
    delete sparseRooms.rooms[0]
    expect(validateStageLayout(sparseRooms).valid).toBe(false)
    const sparsePlacements = mutableLayout(layout(2))
    delete sparsePlacements.placements[0]
    expect(validateStageLayout(sparsePlacements).valid).toBe(false)
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const sparseTiles = clone(compiled.map)
    delete sparseTiles.tiles[0]
    expect(validateStageMap(sparseTiles).valid).toBe(false)
    const sparseRow = clone(compiled.map)
    delete sparseRow.tiles[0]![0]
    expect(validateStageMap(sparseRow).valid).toBe(false)
    const sparseMapRooms = clone(compiled.map)
    delete sparseMapRooms.rooms[0]
    expect(validateStageMap(sparseMapRooms).valid).toBe(false)
    const sparseMapDoors = clone(compiled.map)
    delete sparseMapDoors.doors[0]
    expect(validateStageMap(sparseMapDoors).valid).toBe(false)
    const oversizedCompiled = clone(compiled) as unknown as { placements: unknown[] }
    oversizedCompiled.placements = new Array(1_000_000)
    const oversizedResult = validateCompiledStage(oversizedCompiled)
    expect(oversizedResult.valid).toBe(false)
    expect(oversizedResult.errors).toContain('placements: expected 1 to 11 placements')
  })

  it('rejects identity, extra-key, and compiled entity corruption', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const identityCorrupt = clone(compiled.map)
    identityCorrupt.seed = 'changed-seed'
    expect(validateStageMap(identityCorrupt).valid).toBe(false)
    const generatorCorrupt = clone(compiled.map)
    generatorCorrupt.generatorVersion = 'other-generator' as typeof generatorCorrupt.generatorVersion
    expect(validateStageMap(generatorCorrupt).valid).toBe(false)
    for (const doorId of ['__proto__', 'door:other-room']) {
      const doorIdentityCorrupt = clone(compiled.map)
      doorIdentityCorrupt.doors[0]!.id = doorId
      const doorResult = validateStageMap(validMapWithId(doorIdentityCorrupt))
      expect(doorResult.valid).toBe(false)
      expect(doorResult.errors).toContain('doors[0].id: must match room-derived door id')
    }
    const oversizedMap = clone(compiled.map)
    oversizedMap.width = 129
    expect(validateStageMap(oversizedMap).valid).toBe(false)
    const extraMap = clone(compiled.map) as StageMap & Record<string, unknown>
    extraMap.privateContext = 'hidden'
    expect(validateStageMap(extraMap).valid).toBe(false)
    const extraRoom = clone(compiled.map)
    ;(extraRoom.rooms[0] as typeof extraRoom.rooms[number] & { options?: unknown }).options = []
    expect(validateStageMap(extraRoom).valid).toBe(false)
    const missingEntity = clone(compiled)
    missingEntity.placements.splice(missingEntity.placements.findIndex(({ kind }) => kind === 'decision'), 1)
    expect(validateCompiledStage(missingEntity).valid).toBe(false)
    const addedEntity = clone(compiled)
    addedEntity.placements.push({
      id: 'evidence-ledger',
      kind: 'evidence',
      roomId: 'archive',
      position: firstRoomFloor(compiled),
    })
    expect(validateCompiledStage(addedEntity).valid).toBe(false)
    const badSpawn = clone(compiled)
    badSpawn.playerSpawn = { x: Number.NaN, y: badSpawn.playerSpawn.y }
    expect(validateCompiledStage(badSpawn).valid).toBe(false)
    const reservedSpawn = clone(compiled)
    reservedSpawn.playerSpawn = clone(compiled.map.doors[0]!.inside)
    const reservedSpawnResult = validateCompiledStage(reservedSpawn)
    expect(reservedSpawnResult.valid).toBe(false)
    expect(reservedSpawnResult.errors).toContain('playerSpawn: reserved door approach')
    const fractionalPlacement = clone(compiled)
    fractionalPlacement.placements[0]!.position.x += 0.5
    expect(validateCompiledStage(fractionalPlacement).valid).toBe(false)
    const extraDoorPoint = clone(compiled.map)
    ;(extraDoorPoint.doors[0]!.position as typeof extraDoorPoint.doors[number]['position'] & { extra?: unknown }).extra = 'hidden'
    expect(validateStageMap(extraDoorPoint).valid).toBe(false)
    const extraCompiled = clone(compiled) as CompiledStage & Record<string, unknown>
    extraCompiled.privateContext = 'hidden'
    expect(validateCompiledStage(extraCompiled).valid).toBe(false)
  })

  it('handles doors, shortest routes, endpoint validation, and deterministic neighbors', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const door = compiled.map.doors[0]!
    const openDoors = { ...compiled.initialDoors, [door.id]: 'open' as const }
    const closedDoors = { ...openDoors, [door.id]: 'closed' as const }
    const openPath = findPath(compiled.map, openDoors, door.inside, door.outside)
    expect(openPath).toEqual([door.position, door.outside])
    expect(findPath(compiled.map, {}, door.inside, door.outside)).toBeNull()
    expect(findPath(compiled.map, closedDoors, door.inside, door.outside)).toBeNull()
    expect(findPath(compiled.map, openDoors, door.position, door.position)).toEqual([])
    expect(findPath(compiled.map, closedDoors, door.position, door.position)).toBeNull()
    expect(findPath(compiled.map, openDoors, { x: -1, y: -1 }, { x: -1, y: -1 })).toBeNull()
    expect(findPath(compiled.map, openDoors, { x: 0.5, y: 1 }, { x: 0.5, y: 1 })).toBeNull()
    expect(findPath(compiled.map, openDoors, { x: Number.NaN, y: 1 }, { x: Number.NaN, y: 1 })).toBeNull()
    const same = firstRoomFloor(compiled)
    expect(findPath(compiled.map, openDoors, same, same)).toEqual([])
    expect(canStep(compiled.map, openDoors, same, { x: same.x + 1, y: same.y })).toBe(true)
    expect(canStep(compiled.map, openDoors, same, { x: same.x + 1, y: same.y + 1 })).toBe(false)
    expect(canStep(compiled.map, openDoors, same, { x: same.x + 2, y: same.y })).toBe(false)
    expect(canStep(compiled.map, openDoors, openPath![0]!, openPath![1]!)).toBe(true)
    expect(canStep(compiled.map, closedDoors, openPath![0]!, openPath![1]!)).toBe(false)
    const allOpenDoors = Object.fromEntries(compiled.map.doors.map(({ id }) => [id, 'open' as const]))
    for (const placement of compiled.placements) {
      expect(findPath(compiled.map, allOpenDoors, compiled.playerSpawn, placement.position)).not.toBeNull()
    }
    const inherited = Object.create({ [door.id]: 'open' })
    expect(isWalkable(compiled.map, inherited, door.position)).toBe(false)
    const invalidDoors: DoorStates = { ...openDoors, [door.id]: 'invalid' as never }
    expect(isWalkable(compiled.map, invalidDoors, door.position)).toBe(false)
    expect(canStep(compiled.map, closedDoors, door.inside, door.position)).toBe(false)
  })

  it('reports outdoor, room, door, wall, and out-of-bounds spaces', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const door = compiled.map.doors[0]!
    const room = compiled.map.rooms.find(({ id }) => id === door.roomId)!
    expect(spaceAt(compiled.map, { x: 1, y: 1 })).toEqual({ kind: 'outdoor' })
    expect(spaceAt(compiled.map, { x: room.x + 1, y: room.y + 1 })).toEqual({
      kind: 'room',
      roomId: room.id,
    })
    expect(spaceAt(compiled.map, door.position)).toEqual({ kind: 'door', doorId: door.id })
    expect(spaceAt(compiled.map, { x: room.x, y: room.y })).toBeNull()
    expect(spaceAt(compiled.map, { x: room.x + 0.5, y: room.y + 1 })).toBeNull()
    expect(spaceAt(compiled.map, { x: Number.NaN, y: room.y + 1 })).toBeNull()
    expect(spaceAt(compiled.map, { x: -1, y: 0 })).toBeNull()
  })

  it('keeps interaction range within one matching space only', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const room = compiled.map.rooms[0]!
    const inside = { x: room.x + 1, y: room.y + 1 }
    expect(isInInteractionRange(compiled.map, compiled.initialDoors, inside, { x: inside.x + 1, y: inside.y })).toBe(true)
    expect(isInInteractionRange(compiled.map, compiled.initialDoors, inside, { x: room.x - 1, y: inside.y })).toBe(false)
    expect(isInInteractionRange(compiled.map, compiled.initialDoors, inside, { x: inside.x + 1, y: inside.y + 1 })).toBe(false)
    expect(isInInteractionRange(compiled.map, compiled.initialDoors, inside, { x: room.x + 1, y: room.y - 1 })).toBe(false)
    const otherRoom = compiled.map.rooms.find(({ id }) => id !== room.id)!
    expect(isInInteractionRange(compiled.map, compiled.initialDoors, inside, { x: otherRoom.x + 1, y: otherRoom.y + 1 })).toBe(false)
  })

  it('projects an allowlisted detached map without runtime or private fields', () => {
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const source = clone(compiled) as CompiledStage & Record<string, unknown>
    const sentinel = 'projection-private-sentinel'
    source.privateContext = sentinel
    ;(source.map as StageMap & Record<string, unknown>).placements = []
    ;(source.map.rooms[0] as StageMap['rooms'][number] & { privateContext?: string }).privateContext = sentinel
    ;(source.map.doors[0] as StageMap['doors'][number] & { privateContext?: string }).privateContext = sentinel
    for (const point of ['position', 'inside', 'outside'] as const) {
      ;(source.map.doors[0]![point] as StageMap['doors'][number][typeof point] & { privateContext?: string }).privateContext = sentinel
    }
    const projection = projectMap(source)
    expect(projection).not.toHaveProperty('playerSpawn')
    expect(projection).not.toHaveProperty('placements')
    expect(projection).not.toHaveProperty('initialDoors')
    expect(projection).not.toHaveProperty('privateContext')
    expect(JSON.stringify(projection)).not.toContain(sentinel)
    projection.tiles[0]![0] = 'grass'
    projection.rooms[0]!.x = 99
    projection.doors[0]!.position.x = 99
    expect(source.map.tiles[0]![0]).not.toBe('grass')
    expect(source.map.rooms[0]!.x).not.toBe(99)
    expect(source.map.doors[0]!.position.x).not.toBe(99)
  })

  it('does not mutate frozen inputs, maps, or door states', () => {
    const input = deepFreeze(clone(settlementFixture))
    const compiled = compileStage(input, 'fixture-seed')
    const frozenMap = deepFreeze(clone(compiled.map))
    const frozenDoors = deepFreeze({ ...compiled.initialDoors })
    expect(() => {
      spaceAt(frozenMap, { x: 1, y: 1 })
      findPath(frozenMap, frozenDoors, compiled.playerSpawn, compiled.playerSpawn)
      projectMap({ ...compiled, map: frozenMap })
    }).not.toThrow()
    expect(compiled).toEqual(compileStage(settlementFixture, 'fixture-seed'))
  })
})
