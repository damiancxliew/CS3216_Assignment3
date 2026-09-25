import type { MapRoom, Point } from './types.js'

export const ROOM_SHAPES = ['rectangle', 'rounded', 'octagonal', 'courtyard-wing'] as const
export type RoomShape = typeof ROOM_SHAPES[number]

/** The bounding box is only a layout slot. Membership follows the actual footprint. */
export function roomContains(room: MapRoom, point: Point): boolean {
  const x = point.x - room.x, y = point.y - room.y
  const w = room.width, h = room.height
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const edgeX = Math.min(x, w - 1 - x), edgeY = Math.min(y, h - 1 - y)
  if (room.shape === 'octagonal') return edgeX + edgeY >= 2
  if (room.shape === 'rounded') {
    const radius = Math.min(3, Math.floor(Math.min(w, h) / 2))
    return edgeX >= radius || edgeY >= radius || (radius - edgeX - .5) ** 2 + (radius - edgeY - .5) ** 2 <= radius ** 2
  }
  if (room.shape === 'courtyard-wing') return !(x < Math.floor(w / 3) && y < Math.floor(h / 2))
  return true
}

export function roomInterior(room: MapRoom, point: Point): boolean {
  return roomContains(room, point) && [[0, -1], [0, 1], [-1, 0], [1, 0]].every(([dx, dy]) => roomContains(room, { x: point.x + dx!, y: point.y + dy! }))
}
