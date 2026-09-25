import { describe, expect, it } from 'vitest'
import { compileStage, findPath, isWalkable, projectMap, roomContains, roomInterior, ROOM_SHAPES, spaceAt, validateStageMap, type RoomSize } from '../src/index.js'

describe('authored room footprints', () => {
  for (const shape of ROOM_SHAPES) it(`${shape} keeps fixtures, spawns and door approaches valid across sizes/seeds`, () => {
    for (const size of ['small', 'medium', 'large'] as RoomSize[]) for (let seed = 0; seed < 12; seed++) {
      const layout = { stageId: 'shapes', spawnRoomId: 'hall', rooms: [{ id: 'hall', size, shape, enclosure: 'enclosed', doorDefault: 'closed' }, { id: 'square', size: 'large', shape, enclosure: 'open', doorDefault: null }], scenery: { palette: ['crate', 'bench', 'planter'], density: 'busy' }, landmarks: [{ roomId: 'hall', kind: 'table' }, { roomId: 'square', kind: 'tree' }], placements: [{ id: 'decision', kind: 'decision', roomId: 'hall' }] }
      const compiled = compileStage(layout, `shape-${seed}`), map = compiled.map
      expect(validateStageMap(projectMap(compiled)).valid).toBe(true)
      expect(map.scenery!.length).toBeGreaterThan(0)
      for (const prop of map.scenery!) {
        expect(isWalkable(map, compiled.initialDoors, prop)).toBe(false)
        expect(compiled.placements.some(p => p.position.x === prop.x && p.position.y === prop.y)).toBe(false)
      }
      const room = map.rooms.find(r => r.id === 'hall')!, door = map.doors[0]!
      expect(roomInterior(room, compiled.playerSpawn)).toBe(true)
      expect(spaceAt(map, compiled.playerSpawn)).toEqual({ kind: 'room', roomId: room.id })
      expect(isWalkable(map, compiled.initialDoors, door.position)).toBe(false)
      expect(findPath(map, { [door.id]: 'open' }, compiled.playerSpawn, door.outside)).not.toBeNull()
      if (shape !== 'rectangle') {
        expect(roomContains(room, { x: room.x, y: room.y })).toBe(false)
        expect(spaceAt(map, { x: room.x, y: room.y })).toEqual({ kind: 'outdoor' })
      }
      expect(compileStage(layout, `shape-${seed}`)).toEqual(compiled)
    }
  })
})
