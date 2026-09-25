import { roomContains } from './room-shapes.js'
import { canStep, findPath, isWalkable, spaceAt } from './spatial.js'
import type { Point, PublicActorPosition, RoomWalkResult, SpatialState, StageMap } from './types.js'

function actorPosition(state: SpatialState, actorId: string): Point | undefined {
  return Object.prototype.hasOwnProperty.call(state.actors, actorId) ? state.actors[actorId] : undefined
}

export function moveActor(map: StageMap, state: SpatialState, actorId: string, to: Point): SpatialState {
  const from = actorPosition(state, actorId)
  if (!from || !canStep(map, state.doors, from, to)) return state
  return { doors: state.doors, actors: { ...state.actors, [actorId]: { x: to.x, y: to.y } } }
}

export function closeSpatialDoor(map: StageMap, state: SpatialState, doorId: string): SpatialState {
  const door = map.doors.find(({ id }) => id === doorId)
  if (!door) return state
  const displaced = Object.entries(state.actors).filter(([, point]) => point.x === door.position.x && point.y === door.position.y)
  if (Object.prototype.hasOwnProperty.call(state.doors, doorId) && state.doors[doorId] === 'closed' && displaced.length === 0) return state
  const actors = displaced.length === 0 ? state.actors : {
    ...state.actors,
    ...Object.fromEntries(displaced.map(([id]) => [id, { x: door.outside.x, y: door.outside.y }])),
  }
  return { doors: { ...state.doors, [doorId]: 'closed' }, actors }
}

export function walkActorTowardRoom(map: StageMap, state: SpatialState, actorId: string, roomId: string): RoomWalkResult {
  const from = actorPosition(state, actorId)
  const room = map.rooms.find((entry) => entry.id === roomId)
  if (!from || !room || !isWalkable(map, state.doors, from)) return { state, status: 'unreachable' }
  const insideRoom = (point: Point): boolean =>
    roomContains(room, point)
  if (room.enclosure === 'open') {
    if (insideRoom(from)) return { state, status: 'arrived' }
    const target = { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) }
    const path = findPath(map, state.doors, from, target)
    if (path === null) return { state, status: 'unreachable' }
    if (path.length === 0) return { state, status: 'arrived' }
    const next = moveActor(map, state, actorId, path[0]!)
    const position = actorPosition(next, actorId)!
    return { state: next, status: insideRoom(position) ? 'arrived' : 'moving' }
  }
  const door = map.doors.find((entry) => entry.roomId === roomId)
  if (!door) return { state, status: 'unreachable' }
  const currentSpace = spaceAt(map, from)
  if (currentSpace?.kind === 'room' && currentSpace.roomId === roomId) return { state, status: 'arrived' }
  const doorOpen = isWalkable(map, state.doors, door.position)
  const target = doorOpen ? door.inside : door.outside
  const path = findPath(map, state.doors, from, target)
  if (path === null) return { state, status: 'unreachable' }
  if (path.length === 0) return { state, status: 'waiting_for_door' }
  const next = moveActor(map, state, actorId, path[0]!)
  const position = actorPosition(next, actorId)!
  const nextSpace = spaceAt(map, position)
  const arrived = nextSpace?.kind === 'room' && nextSpace.roomId === roomId
  const waiting = !doorOpen && position.x === door.outside.x && position.y === door.outside.y
  return { state: next, status: arrived ? 'arrived' : waiting ? 'waiting_for_door' : 'moving' }
}

export function projectActorPositions(state: SpatialState): PublicActorPosition[] {
  return Object.keys(state.actors).sort().map((id) => ({ id, position: { x: state.actors[id]!.x, y: state.actors[id]!.y } }))
}
