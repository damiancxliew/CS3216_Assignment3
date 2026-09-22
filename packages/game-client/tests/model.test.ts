import { describe, expect, it } from 'vitest'
import { PlaygroundModel } from '../src/model.js'

function actor(snapshot: ReturnType<PlaygroundModel['snapshot']>, id: string) {
  return snapshot.actors.find((entry) => entry.id === id)!
}

function door(snapshot: ReturnType<PlaygroundModel['snapshot']>, roomId: string) {
  const room = snapshot.map.rooms.find((entry) => entry.id === roomId)!
  return snapshot.map.doors.find((entry) => entry.roomId === room.id)!
}

function stepUntil(model: PlaygroundModel, predicate: (snapshot: ReturnType<PlaygroundModel['snapshot']>) => boolean) {
  for (let index = 0; index < model.snapshot().map.width * model.snapshot().map.height; index += 1) {
    model.step()
    if (predicate(model.snapshot())) return
  }
  throw new Error('model did not reach expected state')
}

describe('PlaygroundModel', () => {
  it('is deterministic, preserves failed reset state, and detaches snapshots', () => {
    const first = new PlaygroundModel('harbor-demo')
    const second = new PlaygroundModel('harbor-demo')
    expect(first.snapshot()).toEqual(second.snapshot())
    const before = first.snapshot()
    first.navigateToRoom('archive')
    const beforeReset = first.snapshot()
    expect(first.snapshot().playerGoal).not.toBeNull()
    expect(() => first.reset('bad seed!')).toThrow()
    expect(first.snapshot()).toEqual(beforeReset)
    expect(first.snapshot().map.id).toBe(before.map.id)
    expect(first.snapshot().playerGoal).toEqual({ kind: 'room', roomId: 'archive' })
    const detached = first.snapshot()
    detached.map.tiles[0]![0] = 'grass'
    detached.actors[0]!.position.x = 999
    detached.doors[Object.keys(detached.doors)[0]!] = 'closed'
    detached.playerGoal = { kind: 'point', point: { x: 999, y: 999 } }
    expect(first.snapshot().map.tiles[0]![0]).not.toBe('grass')
    expect(first.snapshot().actors[0]!.position.x).not.toBe(999)
    expect(first.snapshot().playerGoal).toEqual({ kind: 'room', roomId: 'archive' })
    expect(first.snapshot().map.id).not.toBe(new PlaygroundModel('other-seed').snapshot().map.id)
  })

  it('walks room goals one tile per tick, respects walls, and manual movement cancels goals', () => {
    const model = new PlaygroundModel('walk-test')
    model.setNpcRoutes(false)
    model.navigateToRoom('market')
    let previous = actor(model.snapshot(), 'player').position
    for (let index = 0; index < 200 && model.snapshot().playerStatus !== 'arrived'; index += 1) {
      model.step()
      const current = actor(model.snapshot(), 'player').position
      expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBeLessThanOrEqual(1)
      previous = current
    }
    expect(actor(model.snapshot(), 'player').space).toEqual({ kind: 'room', roomId: 'market' })
    expect(model.snapshot().playerGoal).toBeNull()
    model.navigateToRoom('archive')
    const before = model.snapshot()
    model.movePlayer(1, 0)
    expect(model.snapshot().playerGoal).toBeNull()
    expect(model.snapshot().playerStatus).toBe('idle')
    expect(model.snapshot().revision).toBeGreaterThan(before.revision)
    const wall = model.snapshot().map.rooms[0]!
    const unchanged = model.snapshot()
    model.navigateToPoint({ x: wall.x, y: wall.y })
    expect(model.snapshot().playerStatus).toBe('unreachable')
    expect(actor(model.snapshot(), 'player').position).toEqual(actor(unchanged, 'player').position)
    model.navigateToRoom('missing-room')
    expect(model.snapshot().playerGoal).toBeNull()
  })

  it('waits at a closed destination and resumes after an explicit door opening', () => {
    const model = new PlaygroundModel('door-test')
    model.setNpcRoutes(false)
    const target = door(model.snapshot(), 'archive')
    model.navigateToRoom('archive')
    stepUntil(model, (snapshot) => snapshot.playerStatus === 'waiting_for_door')
    expect(actor(model.snapshot(), 'player').position).toEqual(target.outside)
    expect(actor(model.snapshot(), 'player').space).toEqual({ kind: 'outdoor' })
    const waiting = model.snapshot()
    model.step()
    expect(model.snapshot().revision).toBeGreaterThan(waiting.revision)
    expect(actor(model.snapshot(), 'player').position).toEqual(target.outside)
    model.toggleDoor(target.id)
    model.step()
    expect(actor(model.snapshot(), 'player').space).toEqual({ kind: 'door', doorId: target.id })
    model.step()
    expect(actor(model.snapshot(), 'player').space).toEqual({ kind: 'room', roomId: 'archive' })
  })

  it('closes doorway doors with shared core displacement and re-plans waiting actors', () => {
    const model = new PlaygroundModel('closure-test')
    model.setNpcRoutes(false)
    const target = door(model.snapshot(), 'archive')
    model.toggleDoor(target.id)
    model.navigateToPoint(target.inside)
    stepUntil(model, (snapshot) => {
      const space = actor(snapshot, 'player').space
      return space?.kind === 'door' && space.doorId === target.id
    })
    model.toggleDoor(target.id)
    const displaced = actor(model.snapshot(), 'player')
    expect(displaced.position).toEqual(target.outside)
    expect(displaced.space).toEqual({ kind: 'outdoor' })
    expect(model.snapshot().playerGoal).toBeNull()
    expect(model.snapshot().playerStatus).toBe('unreachable')
    model.toggleDoor(target.id)
    model.step()
    expect(model.snapshot().playerGoal).toBeNull()
    expect(actor(model.snapshot(), 'player').space).toEqual({ kind: 'outdoor' })
  })

  it('keeps NPC routes stable, allows player progress while disabled, and supports manual ticks', () => {
    const pausedModel = new PlaygroundModel('paused-test')
    pausedModel.setRunning(false)
    const paused = pausedModel.snapshot()
    pausedModel.step()
    expect(pausedModel.snapshot().revision).toBe(paused.revision + 1)
    pausedModel.setNpcRoutes(false)
    const frozenNpc = pausedModel.snapshot().actors.filter(({ id }) => id !== 'player').map(({ id, position }) => ({ id, position }))
    pausedModel.navigateToRoom('market')
    pausedModel.step()
    expect(pausedModel.snapshot().playerStatus).toBe('moving')
    expect(pausedModel.snapshot().actors.filter(({ id }) => id !== 'player').map(({ id, position }) => ({ id, position }))).toEqual(frozenNpc)
    const left = new PlaygroundModel('npc-test')
    const right = new PlaygroundModel('npc-test')
    left.setRunning(false)
    right.setRunning(false)
    for (let index = 0; index < 10; index += 1) {
      left.step()
      right.step()
    }
    expect(left.snapshot().actors).toEqual(right.snapshot().actors)
  })

  it('traces deterministic NPC routes through outdoors and doorways for 200 ticks without blocking', () => {
    const left = new PlaygroundModel('npc-trace')
    const right = new PlaygroundModel('npc-trace')
    for (const entry of left.snapshot().map.doors) {
      if (left.snapshot().doors[entry.id] === 'closed') {
        left.toggleDoor(entry.id)
        right.toggleDoor(entry.id)
      }
    }
    const previous = new Map(left.snapshot().actors.filter(({ id }) => id !== 'player').map(({ id, position }) => [id, position]))
    const spaces = new Map<string, Set<string>>()
    for (let tick = 0; tick < 200; tick += 1) {
      left.step()
      right.step()
      expect(left.snapshot().actors).toEqual(right.snapshot().actors)
      for (const entry of left.snapshot().actors.filter(({ id }) => id !== 'player')) {
        const before = previous.get(entry.id)!
        expect(Math.abs(entry.position.x - before.x) + Math.abs(entry.position.y - before.y)).toBeLessThanOrEqual(1)
        previous.set(entry.id, entry.position)
        const seen = spaces.get(entry.id) ?? new Set<string>()
        if (entry.space) seen.add(entry.space.kind === 'room' ? `room:${entry.space.roomId}` : entry.space.kind)
        spaces.set(entry.id, seen)
      }
    }
    for (const seen of spaces.values()) {
      expect([...seen].some((value) => value === 'outdoor')).toBe(true)
      expect([...seen].some((value) => value === 'door')).toBe(true)
      expect([...seen].filter((value) => value.startsWith('room:')).length).toBeGreaterThan(1)
    }
  })

  it('arrives on a one-step point goal in the same tick and cancels blocked goals', () => {
    const model = new PlaygroundModel('point-test')
    model.setNpcRoutes(false)
    const initial = model.snapshot()
    const player = actor(initial, 'player')
    const target = [{ x: player.position.x + 1, y: player.position.y }, { x: player.position.x - 1, y: player.position.y }, { x: player.position.x, y: player.position.y + 1 }, { x: player.position.x, y: player.position.y - 1 }].find(({ x, y }) => initial.map.tiles[y]?.[x] === 'floor')!
    model.navigateToPoint(target)
    model.step()
    expect(actor(model.snapshot(), 'player').position).toEqual(target)
    expect(model.snapshot().playerGoal).toBeNull()
    expect(model.snapshot().playerStatus).toBe('arrived')
    const targetDoor = door(model.snapshot(), 'archive')
    model.toggleDoor(targetDoor.id)
    model.navigateToPoint(targetDoor.inside)
    model.step()
    model.toggleDoor(targetDoor.id)
    expect(model.snapshot().playerGoal).toBeNull()
    expect(model.snapshot().playerStatus).toBe('unreachable')
  })

  it('keeps a room goal waiting when an unrelated door changes', () => {
    const model = new PlaygroundModel('unrelated-door-test')
    model.setNpcRoutes(false)
    model.navigateToRoom('archive')
    stepUntil(model, (snapshot) => snapshot.playerStatus === 'waiting_for_door')
    const unrelated = door(model.snapshot(), 'meeting-hall')
    model.toggleDoor(unrelated.id)
    expect(model.snapshot().playerGoal).toEqual({ kind: 'room', roomId: 'archive' })
    expect(model.snapshot().playerStatus).toBe('waiting_for_door')
  })

  it('rejects invalid points and unknown doors without teleporting', () => {
    const model = new PlaygroundModel('validation-test')
    const before = model.snapshot()
    model.navigateToPoint({ x: 0.5, y: 1 })
    expect(model.snapshot().playerGoal).toBeNull()
    expect(actor(model.snapshot(), 'player').position).toEqual(actor(before, 'player').position)
    const doorId = Object.keys(model.snapshot().doors)[0]!
    model.toggleDoor('missing-door')
    expect(model.snapshot().doors).toEqual(before.doors)
    model.toggleDoor(doorId)
    expect(model.snapshot().doors[doorId]).not.toBe(before.doors[doorId])
  })
})
