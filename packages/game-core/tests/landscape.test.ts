import { describe, expect, it } from 'vitest'
import { compileStage, findPath, isWalkable, projectMap, validateStageMap, waterContains, type LandscapePlan } from '../src/index.js'

const base = {
  stageId: 'landscape', spawnRoomId: 'office', rooms: [
    { id: 'office', size: 'medium', shape: 'courtyard-wing', enclosure: 'enclosed', doorDefault: 'open' },
    { id: 'hall', size: 'large', shape: 'octagonal', enclosure: 'enclosed', doorDefault: 'open' },
    { id: 'market', size: 'medium', shape: 'rounded', enclosure: 'open', doorDefault: null },
  ], landmarks: [{ roomId: 'office', kind: 'table' }, { roomId: 'hall', kind: 'monument' }, { roomId: 'market', kind: 'stall' }],
  placements: [{ id: 'decision', kind: 'decision', roomId: 'office' }, { id: 'clerk', kind: 'actor', roomId: 'office' }, { id: 'record', kind: 'evidence', roomId: 'hall' }],
  scenery: { palette: ['planter', 'bench', 'lamp', 'flowerbed', 'crate', 'barrel', 'awning', 'palm'], density: 'busy' },
}
describe('story landscape geometry', () => {
  for (const [layout, water] of [['garden-loop', 'pond'], ['quayside', 'harbor'], ['meandering', 'oasis']] as const) {
    it(`${layout}: water stays inside, all entrances stay reachable, and scenery remains solid`, () => {
      for (let seed = 0; seed < 8; seed++) {
        const input = { ...base, landscape: { layout, water } }, compiled = compileStage(input, `land-${seed}`), map = compiled.map
        expect(validateStageMap(projectMap(compiled))).toEqual({ valid: true, errors: [] })
        expect(map.waterBodies).toHaveLength(1)
        const body = map.waterBodies![0]!
        expect(body.x).toBeGreaterThan(1); expect(body.y).toBeGreaterThan(1)
        expect(body.x + body.width).toBeLessThan(map.width - 1); expect(body.y + body.height).toBeLessThan(map.height - 1)
        for (let y = body.y; y < body.y + body.height; y++) for (let x = body.x; x < body.x + body.width; x++) if (waterContains(body, { x, y })) expect(isWalkable(map, compiled.initialDoors, { x, y })).toBe(false)
        for (const door of map.doors) expect(findPath(map, compiled.initialDoors, compiled.playerSpawn, door.inside)).not.toBeNull()
        for (const placement of compiled.placements) expect(findPath(map, compiled.initialDoors, compiled.playerSpawn, placement.position)).not.toBeNull()
        for (const item of map.scenery ?? []) { expect(isWalkable(map, compiled.initialDoors, item)).toBe(false); expect(item.x).toBeGreaterThan(1); expect(item.y).toBeGreaterThan(1) }
        expect(compileStage(input, `land-${seed}`).map.id).toBe(map.id)
      }
    })
  }
  it('route topologies change even with the same rooms and seed', () => {
    const signatures = (['garden-loop', 'quayside', 'meandering'] as LandscapePlan['layout'][]).map(layout => {
      const map = compileStage({ ...base, landscape: { layout, water: 'pond' } }, 'same-seed').map
      return JSON.stringify(map.tiles.map(row => row.map(tile => tile === 'path' ? 1 : 0)))
    })
    expect(new Set(signatures).size).toBe(3)
  })
})
