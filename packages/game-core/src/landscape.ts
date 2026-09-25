import { roomContains } from './room-shapes.js'
import type { Point, StageMap, StageLayoutInput } from './types.js'
import type { SceneryKind } from './scenery.js'
export type LandscapePlan = { layout: 'courtyard' | 'garden-loop' | 'quayside' | 'meandering'; water: 'none' | 'pond' | 'harbor' | 'river' | 'oasis' }
export type WaterBody = { x: number; y: number; width: number; height: number; kind: 'pond' | 'basin' | 'oasis' }
export function waterContains(body: WaterBody, point: Point): boolean {
  const nx = (point.x + .5 - body.x - body.width / 2) / (body.width / 2)
  const ny = (point.y + .5 - body.y - body.height / 2) / (body.height / 2)
  return body.kind === 'basin' ? Math.abs(nx) < 1 && Math.abs(ny) < 1 && Math.abs(nx) + Math.abs(ny) < 1.7 : nx * nx + ny * ny < .98
}
const key = (p: Point) => `${p.x},${p.y}`
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Authoritative water and route geometry; absent on legacy compiled maps. */
export function layOutLandscape(map: StageMap, plan: LandscapePlan, reserved: Point[]): void {
  for (const row of map.tiles) for (let x = 0; x < row.length; x++) if (row[x] === 'path') row[x] = 'grass'
  const water: WaterBody[] = []
  if (plan.water !== 'none') {
    // The central outdoor gap is a designed shared space, not another room slot.
    const candidates: Array<{ body: WaterBody; score: number }> = []
    for (const scale of [1, .8, .65]) {
      const w = Math.round((plan.water === 'harbor' ? 12 : plan.water === 'river' ? 13 : 8) * scale)
      const h = Math.round((plan.water === 'harbor' ? 8 : 6) * scale)
      for (let y = 3; y <= map.height - h - 3; y++) for (let x = 3; x <= map.width - w - 3; x++) {
        const body: WaterBody = { x, y, width: w, height: h, kind: plan.water === 'harbor' || plan.water === 'river' ? 'basin' : plan.water === 'oasis' ? 'oasis' : 'pond' }
        let valid = true
        for (let yy = y - 1; yy <= y + h && valid; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
          const p = { x: xx, y: yy }
          if (map.tiles[yy]?.[xx] !== 'grass' || map.rooms.some(r => roomContains(r, p)) || reserved.some(q => distance(p, q) < 2)) { valid = false; break }
        }
        if (valid) candidates.push({ body, score: w * h * 10 - distance({ x: x + w / 2, y: y + h / 2 }, { x: map.width * .54, y: map.height / 2 }) })
      }
      if (candidates.length) break
    }
    candidates.sort((a, b) => b.score - a.score)
    if (candidates[0]) {
      const body = candidates[0].body; water.push(body)
      for (let y = body.y; y < body.y + body.height; y++) for (let x = body.x; x < body.x + body.width; x++) if (waterContains(body, { x, y })) map.tiles[y]![x] = 'water'
    }
  }
  if (water.length) map.waterBodies = water
  const fixture = (p: Point) => map.landmarks?.some(l => p.x >= l.x && p.x < l.x + 2 && p.y >= l.y && p.y < l.y + 2)
  const free = (p: Point) => ['grass', 'path'].includes(map.tiles[p.y]?.[p.x] ?? '') && !fixture(p)
  const nearest = (p: Point): Point => {
    const points: Point[] = []
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) if (free({ x, y })) points.push({ x, y })
    points.sort((a, b) => distance(a, p) - distance(b, p)); return points[0]!
  }
  const route = (from: Point, to: Point) => {
    const start = nearest(from), end = nearest(to)
    const queue = [{ ...start, cost: 0 }], cost = new Map([[key(start), 0]]), parent = new Map<string, Point>()
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost)
      const p = queue.shift()!
      if (p.cost !== cost.get(key(p))) continue
      if (key(p) === key(end)) {
        let at = end
        while (key(at) !== key(start)) { map.tiles[at.y]![at.x] = 'path'; at = parent.get(key(at))! }
        map.tiles[start.y]![start.x] = 'path'; return
      }
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const q = { x: p.x + dx!, y: p.y + dy! }; if (!free(q)) continue
        const existing = map.tiles[q.y]![q.x] === 'path'
        // Gentle low-frequency terrain cost gives caravan trails broad deviations.
        const bend = plan.layout === 'meandering' ? (Math.sin(q.x * .37 + q.y * .28) + 1) * .8 : 0
        const nextCost = p.cost + (existing ? .6 : 1 + bend)
        if (nextCost >= (cost.get(key(q)) ?? Infinity)) continue
        cost.set(key(q), nextCost); parent.set(key(q), p); queue.push({ ...q, cost: nextCost })
      }
    }
    throw new Error('landscape: an entrance has no outdoor route')
  }
  const pond = water[0]
  const cx = pond ? pond.x + pond.width / 2 : map.width / 2, cy = pond ? pond.y + pond.height / 2 : map.height / 2
  const rx = pond ? pond.width / 2 + 2 : 5, ry = pond ? pond.height / 2 + 2 : 3
  let anchors: Point[]
  if (plan.layout === 'garden-loop' || plan.layout === 'courtyard') {
    anchors = Array.from({ length: 8 }, (_, i) => nearest({ x: Math.round(cx + Math.cos(i * Math.PI / 4) * rx), y: Math.round(cy + Math.sin(i * Math.PI / 4) * ry) }))
    for (let i = 0; i < anchors.length; i++) route(anchors[i]!, anchors[(i + 1) % anchors.length]!)
  } else if (plan.layout === 'quayside') {
    anchors = [nearest({ x: cx - rx, y: cy - ry }), nearest({ x: cx - rx, y: cy + ry }), nearest({ x: cx + rx, y: cy + ry }), nearest({ x: cx + rx, y: cy - ry })]
    for (let i = 1; i < anchors.length; i++) route(anchors[i - 1]!, anchors[i]!)
  } else {
    anchors = [{ x: 4, y: cy + 4 }, { x: cx - rx, y: cy + ry }, { x: cx + rx, y: cy - ry }, { x: map.width - 4, y: cy - 3 }].map(nearest)
    for (let i = 1; i < anchors.length; i++) route(anchors[i - 1]!, anchors[i]!)
  }
  for (const room of map.rooms) {
    const entrance = map.doors.find(d => d.roomId === room.id)?.outside ?? nearest({ x: room.x + room.width / 2, y: room.y + room.height / 2 })
    const anchor = [...anchors].sort((a, b) => distance(entrance, a) - distance(entrance, b))[0]!
    route(entrance, anchor)
  }
}

/** Props form useful small scenes: paired entrance planting, cargo yards and waterside seating. */
export function arrangeScenery(map: StageMap, input: NonNullable<StageLayoutInput['scenery']>, protectedPoints: Point[]): NonNullable<StageMap['scenery']> {
  const items: NonNullable<StageMap['scenery']> = []
  const palette = [...new Set(input.palette)]
  const choose = (preferences: SceneryKind[]) => preferences.find(k => palette.includes(k))
  const budget = input.density === 'busy' ? 40 : input.density === 'lived-in' ? 28 : 16
  const add = (p: Point, kind: SceneryKind | undefined) => {
    if (!kind || items.length >= budget || p.x < 2 || p.y < 2 || p.x >= map.width - 2 || p.y >= map.height - 2 || map.tiles[p.y]?.[p.x] !== 'grass') return
    if (protectedPoints.some(q => distance(p, q) < 2) || items.some(q => distance(p, q) < 1.8)) return
    if (map.landmarks?.some(l => p.x >= l.x - 1 && p.x <= l.x + 2 && p.y >= l.y - 1 && p.y <= l.y + 2)) return
    // Props sit beside routes; a one-tile walkable apron remains around their footprint.
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ['wall', 'floor', 'door'].includes(map.tiles[p.y + dy!]?.[p.x + dx!] ?? 'wall'))) return
    items.push({ ...p, kind })
  }
  for (const room of map.rooms) {
    const door = map.doors.find(d => d.roomId === room.id)
    const entry = door?.outside ?? { x: room.x + Math.floor(room.width / 2), y: room.y + room.height - 1 }
    const dy = door && door.outside.y < door.position.y ? -1 : 1
    const greenery = choose(['planter', 'flowerbed', 'palm', 'fern', 'pottery'])
    for (const side of [-1, 1]) {
      add({ x: entry.x + side * 3, y: entry.y + dy }, greenery)
      add({ x: entry.x + side * 5, y: entry.y + dy }, choose(side < 0 ? ['bench', 'urn', 'barrel'] : ['bicycle', 'cart', 'pottery', 'sacks']))
      add({ x: entry.x + side * 5, y: entry.y + dy * 3 }, choose(['flowerbed', 'palm', 'urn']))
    }
    add({ x: entry.x - 3, y: entry.y + dy * 3 }, choose(['noticeboard', 'lamp', 'brazier']))
    add({ x: entry.x + 3, y: entry.y + dy * 3 }, choose(['lamp', 'brazier', 'pottery']))
    const cargo = palette.filter(k => ['crate', 'barrel', 'sacks', 'cart', 'pottery', 'urn', 'rope'].includes(k))
    if (cargo.length > 1) {
      // Loading / market group kept together along one side of the building or stall.
      const anchor = { x: room.x + room.width + 2, y: room.y + Math.floor(room.height * .65) }
      for (const [i, offset] of [[0, 0], [0, 2], [-2, 2], [-2, 4]].entries()) add({ x: anchor.x + offset[0]!, y: anchor.y + offset[1]! }, cargo[i % cargo.length])
      add({ x: entry.x + 4, y: entry.y + dy * 4 }, choose(['crate', 'sacks']))
      add({ x: entry.x + 6, y: entry.y + dy * 4 }, choose(['barrel', 'pottery']))
      add({ x: entry.x + 4, y: entry.y + dy * 6 }, choose(['cart', 'sacks', 'urn']))
    }
    if (room.enclosure === 'open') {
      for (let x = room.x + 2; x < room.x + room.width - 1; x += 3) {
        add({ x, y: room.y + 1 }, choose(x % 2 ? ['awning', 'canopy', 'planter'] : ['canopy', 'awning', 'planter']))
        add({ x, y: room.y + 3 }, choose(['sacks', 'pottery', 'crate', 'flowerbed']))
      }
    }
  }
  for (const water of map.waterBodies ?? []) {
    const marine = water.kind === 'basin'
    const left = water.x - 2, right = water.x + water.width + 1, bottom = water.y + water.height + 1
    for (let y = water.y + 1; y < water.y + water.height; y += 3) {
      add({ x: left, y }, choose(marine ? ['bollard', 'rope', 'barrel'] : ['palm', 'planter', 'fern']))
      add({ x: right, y }, choose(marine ? ['fishing-net', 'anchor', 'crate'] : ['bench', 'pottery', 'boulder']))
    }
    for (let x = water.x + 1; x < water.x + water.width; x += 3) add({ x, y: bottom }, choose(marine ? x % 2 ? ['rope', 'barrel', 'crate'] : ['barrel', 'crate', 'rope'] : ['flowerbed', 'palm', 'urn']))
  }
  // Lamps accompany the path at measured intervals instead of filling empty land.
  for (let y = 3; y < map.height - 3; y += 5) for (let x = 3; x < map.width - 3; x += 5) {
    if (map.tiles[y]?.[x - 2] === 'path' || map.tiles[y]?.[x + 2] === 'path') add({ x, y }, choose(['lamp', 'planter', 'palm']))
  }
  return items
}
