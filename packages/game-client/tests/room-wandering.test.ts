import { describe, expect, it } from 'vitest'
import { compileStage, isWalkable, spaceAt } from '@adventure/game-core'
import { RoomWandering } from '../src/room-wandering.js'
import type { PlaygroundSnapshot } from '../src/model.js'

function fixture(): PlaygroundSnapshot {
  const stage = compileStage({
    stageId: 'wandering', spawnRoomId: 'room',
    rooms: [{ id: 'room', size: 'medium', doorDefault: 'open' }, { id: 'other', size: 'medium', doorDefault: 'open' }],
    landmarks: [{ roomId: 'room', kind: 'shelf' }],
    placements: [
      { id: 'decision', kind: 'decision', roomId: 'room' },
      { id: 'alice', kind: 'actor', roomId: 'room' },
      { id: 'bob', kind: 'actor', roomId: 'room' },
      { id: 'document', kind: 'evidence', roomId: 'room' },
    ],
  }, 'wander-test')
  return {
    seed: 'test', map: stage.map, doors: stage.initialDoors,
    actors: [
      { id: 'player', position: stage.playerSpawn },
      ...stage.placements.filter((item) => item.kind === 'actor'),
    ].map(({ id, position }) => ({ id, name: id, position, space: spaceAt(stage.map, position), status: 'idle', targetRoomId: null })),
    props: stage.placements.filter((item) => item.kind === 'evidence').map((item) => ({ ...item, name: item.id, found: false })),
    playerGoal: null, playerStatus: 'idle', running: true, npcRoutes: false, roomWandering: true, revision: 0,
  }
}

describe('ambient room wandering', () => {
  it('walks adjacent tiles with pauses, staying in the room and avoiding fixtures, people, props and doorways', () => {
    const snapshot = fixture()
    const original = structuredClone(snapshot)
    const wandering = new RoomWandering(() => 0.4)
    wandering.sync(snapshot, true)
    const alice = snapshot.actors.find((actor) => actor.id === 'alice')!
    let previous = alice.position
    let moves = 0
    let pauses = 0
    for (let tick = 0; tick < 1000; tick += 1) {
      // Polling the same authoritative state must not reset a walk.
      wandering.sync(structuredClone(snapshot), true)
      wandering.advance(snapshot, 100)
      const point = wandering.position(alice.id, alice.position)
      const distance = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)
      expect(distance).toBeLessThanOrEqual(1)
      if (distance) moves += 1
      else pauses += 1
      expect(spaceAt(snapshot.map, point)).toEqual(alice.space)
      expect(isWalkable(snapshot.map, snapshot.doors, point)).toBe(true)
      for (const actor of snapshot.actors.filter((actor) => actor.id !== alice.id)) {
        expect(point).not.toEqual(wandering.position(actor.id, actor.position))
      }
      for (const prop of snapshot.props!) expect(point).not.toEqual(prop.position)
      for (const door of snapshot.map.doors) expect(point).not.toEqual(door.inside)
      previous = { ...point }
    }
    expect(moves).toBeGreaterThan(10)
    expect(pauses).toBeGreaterThan(moves)
    expect(snapshot).toEqual(original)
    expect(wandering.position('player', snapshot.actors[0]!.position)).toEqual(snapshot.actors[0]!.position)
  })

  it('holds hovered characters, resets on authoritative moves and clears disabled or removed actors', () => {
    const snapshot = fixture()
    const wandering = new RoomWandering(() => 0)
    const alice = snapshot.actors.find((actor) => actor.id === 'alice')!
    wandering.sync(snapshot, true)
    for (let tick = 0; tick < 100; tick += 1) wandering.advance(snapshot, 100, 'alice')
    expect(wandering.position('alice', alice.position)).toEqual(alice.position)
    for (let tick = 0; tick < 20; tick += 1) wandering.advance(snapshot, 100)
    expect(wandering.position('alice', alice.position)).not.toEqual(alice.position)
    const room = snapshot.map.rooms.find((item) => item.id === 'other')!
    alice.position = { x: room.x + 2, y: room.y + 2 }
    wandering.sync(snapshot, true)
    expect(wandering.position('alice', alice.position)).toEqual(alice.position)
    wandering.sync(snapshot, false)
    const fallback = { x: 0, y: 0 }
    expect(wandering.position('alice', fallback)).toEqual(fallback)
    wandering.sync(snapshot, true)
    snapshot.actors = snapshot.actors.filter((actor) => actor.id !== 'alice')
    wandering.sync(snapshot, true)
    expect(wandering.position('alice', fallback)).toEqual(fallback)
  })

  it('leaves outdoor characters at their authoritative hearing positions', () => {
    const snapshot = fixture()
    const alice = snapshot.actors.find((actor) => actor.id === 'alice')!
    alice.position = snapshot.map.doors[0]!.outside
    const wandering = new RoomWandering(() => 0)
    wandering.sync(snapshot, true)
    for (let tick = 0; tick < 100; tick += 1) wandering.advance(snapshot, 100)
    expect(wandering.position('alice', alice.position)).toEqual(alice.position)
  })
})
