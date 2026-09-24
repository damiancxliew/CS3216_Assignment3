import type { DoorStates, Point, Space, StageMap } from './types.js'
import { landmarkAt } from './landmarks.js'

function isIntegerPoint(point: Point): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
}

function inBounds(map: StageMap, point: Point): boolean {
  return isIntegerPoint(point) && point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function doorAt(map: StageMap, point: Point) {
  return map.doors.find((door) => pointKey(door.position) === pointKey(point))
}

function containsPoint(room: StageMap['rooms'][number], point: Point): boolean {
  return point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height
}

function roomAt(map: StageMap, point: Point) {
  return map.rooms.find(
    (room) =>
      room.enclosure === 'enclosed' &&
      point.x > room.x &&
      point.x < room.x + room.width - 1 &&
      point.y > room.y &&
      point.y < room.y + room.height - 1,
  )
}

function openLocationAt(map: StageMap, point: Point) {
  return map.rooms.find((room) => room.enclosure === 'open' && containsPoint(room, point))
}

export function spaceAt(map: StageMap, point: Point): Space | null {
  if (!inBounds(map, point)) return null
  const tile = map.tiles[point.y]?.[point.x]
  if (tile === 'door') {
    const door = doorAt(map, point)
    return door ? { kind: 'door', doorId: door.id } : null
  }
  if (tile === 'floor') {
    const room = roomAt(map, point)
    return room ? { kind: 'room', roomId: room.id } : null
  }
  if (tile === 'grass' || tile === 'path') {
    const location = openLocationAt(map, point)
    return location ? { kind: 'outdoor', locationId: location.id } : { kind: 'outdoor' }
  }
  return null
}

export function areInSameRoom(map: StageMap, left: Point, right: Point): boolean {
  const leftSpace = spaceAt(map, left)
  const rightSpace = spaceAt(map, right)
  return leftSpace?.kind === 'room' && rightSpace?.kind === 'room' && leftSpace.roomId === rightSpace.roomId
}

export function isWalkable(map: StageMap, doors: DoorStates, point: Point): boolean {
  if (!inBounds(map, point)) return false
  if (landmarkAt(map, point)) return false
  const tile = map.tiles[point.y]?.[point.x]
  if (tile === 'grass' || tile === 'path' || tile === 'floor') return true
  if (tile !== 'door') return false
  const door = doorAt(map, point)
  if (door === undefined || typeof doors !== 'object' || doors === null) return false
  return Object.prototype.hasOwnProperty.call(doors, door.id) && doors[door.id] === 'open'
}

function manhattan(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

export function canStep(map: StageMap, doors: DoorStates, from: Point, to: Point): boolean {
  return manhattan(from, to) === 1 && (isWalkable(map, doors, from) || canLeaveLandmark(map, from)) && isWalkable(map, doors, to)
}

export function findPath(map: StageMap, doors: DoorStates, from: Point, to: Point): Point[] | null {
  if ((!isWalkable(map, doors, from) && !canLeaveLandmark(map, from)) || !isWalkable(map, doors, to)) return null
  if (from.x === to.x && from.y === to.y) return []
  const key = pointKey
  const visited = new Set<string>([key(from)])
  const previous = new Map<string, string>()
  const points = new Map<string, Point>([[key(from), { x: from.x, y: from.y }]])
  const queue: Point[] = [{ x: from.x, y: from.y }]
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
      const nextKey = key(next)
      if (visited.has(nextKey) || !isWalkable(map, doors, next)) continue
      visited.add(nextKey)
      previous.set(nextKey, key(current))
      points.set(nextKey, next)
      if (next.x === to.x && next.y === to.y) {
        const path: Point[] = []
        let cursor = nextKey
        while (cursor !== key(from)) {
          path.push(points.get(cursor)!)
          cursor = previous.get(cursor)!
        }
        path.reverse()
        return path
      }
      queue.push(next)
    }
  }
  return null
}

/** A player already standing on a newly added fixture in an old save can step off it. */
function canLeaveLandmark(map: StageMap, point: Point): boolean {
  return !!landmarkAt(map, point) && ['grass', 'path', 'floor'].includes(map.tiles[point.y]?.[point.x] ?? '')
}

function isOutdoorWalkable(map: StageMap, point: Point): boolean {
  if (!inBounds(map, point)) return false
  const tile = map.tiles[point.y]?.[point.x]
  return (tile === 'grass' || tile === 'path') && spaceAt(map, point)?.kind === 'outdoor'
}

export function canHearSpeech(map: StageMap, from: Point, to: Point): boolean {
  if (areInSameRoom(map, from, to)) return true
  if (!isOutdoorWalkable(map, from) || !isOutdoorWalkable(map, to)) return false
  if (pointKey(from) === pointKey(to)) return true
  const visited = new Set<string>([pointKey(from)])
  const queue: { point: Point; distance: number }[] = [{ point: from, distance: 0 }]
  const neighbors = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.distance >= 3) continue
    for (const offset of neighbors) {
      const next = { x: current.point.x + offset.x, y: current.point.y + offset.y }
      const nextKey = pointKey(next)
      if (visited.has(nextKey) || !isOutdoorWalkable(map, next)) continue
      if (nextKey === pointKey(to)) return true
      visited.add(nextKey)
      queue.push({ point: next, distance: current.distance + 1 })
    }
  }
  return false
}

export function isInPhysicalInteractionRange(map: StageMap, doors: DoorStates, from: Point, target: Point): boolean {
  if (!isWalkable(map, doors, from) || !isWalkable(map, doors, target) || manhattan(from, target) > 1) return false
  const sourceSpace = spaceAt(map, from)
  const targetSpace = spaceAt(map, target)
  if (!sourceSpace || !targetSpace || sourceSpace.kind === 'door' || targetSpace.kind === 'door') return false
  if (sourceSpace.kind === 'outdoor' && targetSpace.kind === 'outdoor') return true
  return sourceSpace.kind === 'room' && targetSpace.kind === 'room' && sourceSpace.roomId === targetSpace.roomId
}
