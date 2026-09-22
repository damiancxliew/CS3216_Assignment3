import { describe, expect, it } from 'vitest'
import { settlementFixture } from '../fixtures/settlement.js'
import {
  areInSameRoom,
  canStep,
  closeSpatialDoor,
  compileStage,
  moveActor,
  projectActorPositions,
  spaceAt,
  walkActorTowardRoom,
} from '../src/index.js'
import type { DoorStates, Point, SpatialState, StageMap } from '../src/types.js'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

function allOpen(map: StageMap): DoorStates {
  return Object.fromEntries(map.doors.map(({ id }) => [id, 'open' as const]))
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function state(doors: DoorStates, actors: Record<string, Point>): SpatialState {
  return { doors, actors }
}

const frozenFixture = deepFreeze(clone(settlementFixture))

function walkTrace(map: StageMap, initial: SpatialState, actorId: string, roomId: string) {
  let current = initial
  const trace: { status: string; position: Point; space: ReturnType<typeof spaceAt> }[] = []
  for (let step = 0; step <= map.width * map.height; step += 1) {
    const result = walkActorTowardRoom(map, current, actorId, roomId)
    const position = result.state.actors[actorId]!
    trace.push({ status: result.status, position: { x: position.x, y: position.y }, space: spaceAt(map, position) })
    if (result.status === 'arrived' || result.status === 'waiting_for_door' || result.status === 'unreachable') return { trace, state: result.state, result }
    const previous = current.actors[actorId]!
    expect(Math.abs(position.x - previous.x) + Math.abs(position.y - previous.y)).toBe(1)
    current = result.state
  }
  throw new Error('walk did not settle within the map bound')
}

describe('actor spatial primitives', () => {
  it('moves one actor without collision policy or input mutation', () => {
    const compiled = compileStage(frozenFixture, 'fixture-seed')
    const map = deepFreeze(compiled.map)
    const door = map.doors[0]!
    const doors = deepFreeze(allOpen(map))
    const target = { x: door.position.x, y: door.position.y }
    const original = deepFreeze(state(doors, {
      player: { x: door.inside.x, y: door.inside.y },
      npc: { x: door.position.x, y: door.position.y },
    }))
    const moved = moveActor(map, original, 'player', target)
    expect(moved.actors.player).toEqual(target)
    expect(moved.actors.npc).toEqual(target)
    expect(moved.doors).toBe(original.doors)
    expect(original.actors.player).toEqual(door.inside)
    target.x = 999
    expect(moved.actors.player).toEqual(door.position)
    expect(moveActor(map, original, 'player', { x: door.position.x - 1, y: door.position.y - 1 })).toBe(original)
    expect(moveActor(map, original, 'player', { x: door.position.x + 2, y: door.position.y })).toBe(original)
    expect(moveActor(map, original, 'player', { x: map.rooms[0]!.x, y: map.rooms[0]!.y })).toBe(original)
    const inheritedActors = Object.create({ ghost: door.inside }) as Record<string, Point>
    const inheritedState = deepFreeze(state(doors, inheritedActors))
    expect(moveActor(map, inheritedState, 'ghost', door.position)).toBe(inheritedState)
    expect(moveActor(map, original, 'unknown', door.position)).toBe(original)
  })

  it('closes doors, displaces doorway actors, and preserves other actors and inputs', () => {
    const compiled = compileStage(frozenFixture, 'fixture-seed')
    const map = deepFreeze(compiled.map)
    const door = map.doors[0]!
    const otherDoor = map.doors[1]!
    const doors = deepFreeze(allOpen(map))
    const original = deepFreeze(state(doors, {
      a: clone(door.position),
      b: clone(door.position),
      c: clone(door.outside),
      d: clone(door.inside),
      extra: clone(otherDoor.inside),
    }))
    const originalSnapshot = clone(original)
    const closed = closeSpatialDoor(map, original, door.id)
    expect(closed.doors[door.id]).toBe('closed')
    expect(closed.actors.a).toEqual(door.outside)
    expect(closed.actors.b).toEqual(door.outside)
    expect(closed.actors.c).toEqual(door.outside)
    expect(closed.actors.d).toEqual(door.inside)
    expect(closed.actors.extra).toEqual(otherDoor.inside)
    expect(closed.doors[otherDoor.id]).toBe('open')
    expect(original.doors[door.id]).toBe('open')
    expect(original.actors.a).toEqual(door.position)
    expect(original).toEqual(originalSnapshot)
    expect(canStep(map, closed.doors, door.outside, door.position)).toBe(false)
    const outdoorNeighbors = [
      { x: door.outside.x + 1, y: door.outside.y },
      { x: door.outside.x - 1, y: door.outside.y },
      { x: door.outside.x, y: door.outside.y + 1 },
      { x: door.outside.x, y: door.outside.y - 1 },
    ]
    expect(outdoorNeighbors.some((point) => canStep(map, closed.doors, closed.actors.a!, point))).toBe(true)
    expect(closeSpatialDoor(map, closed, door.id)).toBe(closed)
    expect(closeSpatialDoor(map, closed, 'missing-door')).toBe(closed)
    const alreadyClosed = deepFreeze(state({ [door.id]: 'closed' }, { doorway: clone(door.position) }))
    const displaced = closeSpatialDoor(map, alreadyClosed, door.id)
    expect(displaced.actors.doorway).toEqual(door.outside)
    const missingDoorKey = deepFreeze(state({}, { doorway: clone(door.position) }))
    expect(closeSpatialDoor(map, missingDoorKey, door.id).actors.doorway).toEqual(door.outside)
  })

  it('walks one deterministic tile per call through an open route without actor blocking', () => {
    const compiled = compileStage(frozenFixture, 'fixture-seed')
    const map = deepFreeze(compiled.map)
    const sourceDoor = map.doors[0]!
    const targetDoor = map.doors[1]!
    const doors = deepFreeze(allOpen(map))
    const initial = deepFreeze(state(doors, {
      actor: clone(sourceDoor.inside),
      blocker: clone(targetDoor.outside),
    }))
    const first = walkTrace(map, initial, 'actor', targetDoor.roomId)
    expect(first.result.status).toBe('arrived')
    expect(first.trace.length).toBeGreaterThanOrEqual(3)
    expect(first.trace.some(({ space }) => space?.kind === 'outdoor')).toBe(true)
    expect(first.trace.some(({ space }) => space?.kind === 'door')).toBe(true)
    const second = walkTrace(map, deepFreeze(clone(initial)), 'actor', targetDoor.roomId)
    expect(second.trace).toEqual(first.trace)
    const already = state(doors, { actor: clone(targetDoor.inside) })
    const arrived = walkActorTowardRoom(map, already, 'actor', targetDoor.roomId)
    expect(arrived.status).toBe('arrived')
    expect(arrived.state).toBe(already)
    const unknown = walkActorTowardRoom(map, already, 'missing', targetDoor.roomId)
    expect(unknown.status).toBe('unreachable')
    expect(unknown.state).toBe(already)
    const unknownRoom = walkActorTowardRoom(map, already, 'actor', 'missing-room')
    expect(unknownRoom.status).toBe('unreachable')
    expect(unknownRoom.state).toBe(already)
    const invalidSource = state(doors, { actor: { x: map.rooms[0]!.x, y: map.rooms[0]!.y } })
    const invalid = walkActorTowardRoom(map, invalidSource, 'actor', targetDoor.roomId)
    expect(invalid.status).toBe('unreachable')
    expect(invalid.state).toBe(invalidSource)
  })

  it('waits outside a closed target, resumes only after opening, and handles closure mid-route', () => {
    const compiled = compileStage(frozenFixture, 'fixture-seed')
    const map = deepFreeze(compiled.map)
    const sourceDoor = map.doors[0]!
    const targetDoor = map.doors[1]!
    const doors = { ...allOpen(map), [targetDoor.id]: 'closed' as const }
    const initial = deepFreeze(state(deepFreeze(doors), { actor: clone(sourceDoor.inside) }))
    const waiting = walkTrace(map, initial, 'actor', targetDoor.roomId)
    expect(waiting.result.status).toBe('waiting_for_door')
    expect(spaceAt(map, waiting.state.actors.actor!)).not.toEqual({ kind: 'room', roomId: targetDoor.roomId })
    const repeated = walkActorTowardRoom(map, waiting.state, 'actor', targetDoor.roomId)
    expect(repeated.status).toBe('waiting_for_door')
    expect(repeated.state).toBe(waiting.state)
    const reopened = deepFreeze({ doors: { ...waiting.state.doors, [targetDoor.id]: 'open' as const }, actors: waiting.state.actors })
    const doorway = walkActorTowardRoom(map, reopened, 'actor', targetDoor.roomId)
    expect(spaceAt(map, doorway.state.actors.actor!)).toEqual({ kind: 'door', doorId: targetDoor.id })
    expect(doorway.status).toBe('moving')
    const arrived = walkActorTowardRoom(map, doorway.state, 'actor', targetDoor.roomId)
    expect(arrived.status).toBe('arrived')
    const midRoute = deepFreeze({ doors: allOpen(map), actors: { actor: clone(targetDoor.position) } })
    const displaced = closeSpatialDoor(map, midRoute, targetDoor.id)
    expect(displaced.actors.actor).toEqual(targetDoor.outside)
    const noTrap = walkActorTowardRoom(map, displaced, 'actor', targetDoor.roomId)
    expect(noTrap.status).toBe('waiting_for_door')
    const closedSource = deepFreeze(state({ ...allOpen(map), [sourceDoor.id]: 'closed' as const }, { actor: clone(sourceDoor.inside) }))
    const sourceBlocked = walkActorTowardRoom(map, closedSource, 'actor', targetDoor.roomId)
    expect(sourceBlocked.status).toBe('unreachable')
    expect(sourceBlocked.state).toBe(closedSource)
  })

  it('projects all live actor positions globally with allowlisted detached data', () => {
    const compiled = compileStage(frozenFixture, 'fixture-seed')
    const map = deepFreeze(compiled.map)
    const firstDoor = map.doors[0]!
    const secondDoor = map.doors[1]!
    const firstRoom = map.rooms.find(({ id }) => id === firstDoor.roomId)!
    const farInside = { x: firstRoom.x + firstRoom.width - 2, y: firstRoom.y + firstRoom.height - 2 }
    const doors = deepFreeze(allOpen(map))
    const actors = deepFreeze({
      zed: clone(secondDoor.inside),
      alpha: clone(firstDoor.inside),
      far: farInside,
      outdoor: clone(firstDoor.outside),
      doorway: clone(firstDoor.position),
    })
    const original = deepFreeze(state(doors, actors))
    const projection = projectActorPositions(original)
    expect(projection.map(({ id }) => id)).toEqual(['alpha', 'doorway', 'far', 'outdoor', 'zed'])
    expect(projection).toEqual([
      { id: 'alpha', position: firstDoor.inside },
      { id: 'doorway', position: firstDoor.position },
      { id: 'far', position: farInside },
      { id: 'outdoor', position: firstDoor.outside },
      { id: 'zed', position: secondDoor.inside },
    ])
    for (const actor of projection) expect(Object.keys(actor).sort()).toEqual(['id', 'position'])
    expect(JSON.stringify(projection)).not.toContain('transcript')
    expect(JSON.stringify(projection)).not.toContain('privateContext')
    expect(areInSameRoom(map, firstDoor.inside, farInside)).toBe(true)
    expect(areInSameRoom(map, firstDoor.inside, secondDoor.inside)).toBe(false)
    const detached = projectActorPositions(original)
    detached[0]!.position.x = 999
    expect(original.actors[detached[0]!.id]).not.toEqual(detached[0]!.position)
    const reversed = deepFreeze(state(doors, { doorway: clone(firstDoor.position), outdoor: clone(firstDoor.outside), zed: clone(secondDoor.inside), far: clone(farInside), alpha: clone(firstDoor.inside) }))
    expect(projectActorPositions(reversed)).toEqual(projection)
    expect(pointKey(original.actors.alpha!)).not.toBe(pointKey(detached[0]!.position))
  })
})
