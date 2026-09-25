import { canStep, spaceAt, type Point } from '@adventure/game-core'
import type { PlaygroundSnapshot } from './model.js'

export const ROOM_STEP_MS = 440
const key = (point: Point) => `${point.x},${point.y}`
const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
type Wanderer = { origin: string; roomId: string; position: Point; path: Point[]; wait: number }

/** Ambient presentation only: room-wide conversation still uses server membership.
 * Outdoor actors stay at their authoritative positions because hearing there is distance-based.
 */
export class RoomWandering {
  private actors = new Map<string, Wanderer>()
  private mapId = ''

  constructor(private readonly random: () => number = Math.random) {}

  sync(snapshot: PlaygroundSnapshot, enabled: boolean): void {
    const mapId = `${snapshot.seed}:${snapshot.map.id}`
    if (mapId !== this.mapId || !enabled) this.actors.clear()
    this.mapId = mapId
    if (!enabled) return
    const present = new Set<string>()
    for (const actor of snapshot.actors) {
      const room = spaceAt(snapshot.map, actor.position)
      if (actor.id === 'player' || actor.status === 'moving' || room?.kind !== 'room') continue
      present.add(actor.id)
      const origin = key(actor.position)
      const previous = this.actors.get(actor.id)
      if (previous?.origin === origin && previous.roomId === room.roomId) continue
      this.actors.set(actor.id, {
        origin, roomId: room.roomId, position: { ...actor.position }, path: [],
        wait: 800 + this.random() * 2400,
      })
    }
    for (const id of this.actors.keys()) if (!present.has(id)) this.actors.delete(id)
  }

  position(id: string, fallback: Point): Point {
    return this.actors.get(id)?.position ?? fallback
  }

  advance(snapshot: PlaygroundSnapshot, delta: number, hoveredId?: string): boolean {
    const player = snapshot.actors.find((actor) => actor.id === 'player')
    const playerRoom = player?.space?.kind === 'room' ? player.space.roomId : null
    // Reserve both ends of this frame's steps to prevent crossing through another actor.
    const occupied = new Set([
      ...snapshot.actors.map((actor) => key(actor.position)),
      ...[...this.actors.values()].map((actor) => key(actor.position)),
      ...(snapshot.props ?? []).map((prop) => key(prop.position)),
      ...snapshot.map.doors.map((door) => key(door.inside)),
    ])
    let changed = false
    for (const [id, actor] of this.actors) {
      if (playerRoom === actor.roomId) {
        actor.path = []
        actor.wait = Math.max(actor.wait, 700)
        continue
      }
      // Let the user catch and click a character without chasing it.
      if (hoveredId === id) { actor.wait = Math.max(actor.wait, 700); continue }
      actor.wait -= Math.min(delta, 100)
      if (actor.wait > 0) continue
      const valid = (from: Point, to: Point) => {
        const room = spaceAt(snapshot.map, to)
        return room?.kind === 'room' && room.roomId === actor.roomId
          && !occupied.has(key(to)) && canStep(snapshot.map, snapshot.doors, from, to)
          && !(snapshot.landmarks ?? []).some((item) => to.x >= item.position.x && to.x < item.position.x + item.width
            && to.y >= item.position.y && to.y < item.position.y + item.height)
      }
      if (actor.path.length === 0) {
        // Pick a reachable destination a few tiles away, then follow its whole route.
        const routes: Point[][] = []
        const queue: Array<{ position: Point; path: Point[] }> = [{ position: actor.position, path: [] }]
        const visited = new Set([key(actor.position)])
        for (let index = 0; index < queue.length; index += 1) {
          const current = queue[index]!
          if (current.path.length >= 4) continue
          for (const direction of directions) {
            const next = { x: current.position.x + direction.x, y: current.position.y + direction.y }
            if (visited.has(key(next)) || !valid(current.position, next)) continue
            visited.add(key(next))
            const path = [...current.path, next]
            routes.push(path)
            queue.push({ position: next, path })
          }
        }
        const longer = routes.filter((route) => route.length >= 2)
        const choices = longer.length ? longer : routes
        actor.path = choices[Math.floor(this.random() * choices.length)] ?? []
      }
      const next = actor.path[0]
      if (!next || !valid(actor.position, next)) {
        actor.path = []
        actor.wait = 1200 + this.random() * 2200
        continue
      }
      actor.position = next
      actor.path.shift()
      occupied.add(key(next))
      actor.wait = actor.path.length ? ROOM_STEP_MS : ROOM_STEP_MS + 1600 + this.random() * 4000
      changed = true
    }
    return changed
  }
}
