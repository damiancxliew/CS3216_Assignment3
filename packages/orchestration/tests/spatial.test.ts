import { describe, expect, it } from 'vitest'

import { compileStage, findPath, isWalkable, spaceAt } from '@adventure/game-core'
import {
  advanceSpatialMovement,
  applyAction,
  buildAgentPrompt,
  buildAgentTurnInput,
  createWorld,
  hasConversationExchange,
  moveActorStep,
  DOORWAY_ID,
  OUTDOORS_ID,
  visibleTranscript,
  type WorldSeed,
  type WorldState,
} from '../src/index'

function createSpatialWorld(): WorldState {
  const compiled = compileStage({
    stageId: 'spatial-stage',
    spawnRoomId: 'yard',
    rooms: [
      { id: 'yard', size: 'medium', enclosure: 'open', doorDefault: null },
      { id: 'hall', size: 'medium', enclosure: 'enclosed', doorDefault: 'closed' },
    ],
    placements: [
      { id: 'agent', kind: 'actor', roomId: 'hall' },
      { id: 'decision', kind: 'decision', roomId: 'yard' },
    ],
  }, 'spatial-seed')
  const agentPosition = compiled.placements.find(({ id }) => id === 'agent')!.position
  const rooms = compiled.map.rooms.map((room) => ({
    id: room.id,
    name: room.id === 'yard' ? 'The yard' : 'The hall',
    description: room.id,
    doorOpen: room.enclosure === 'open' || compiled.initialDoors[`door:${room.id}`] === 'open',
    enclosure: room.enclosure,
  }))
  return createWorld({
    rooms,
    actors: [
      { id: 'player', name: 'Player', publicRole: 'visitor', kind: 'player' },
      { id: 'agent', name: 'Agent', publicRole: 'keeper', kind: 'agent' },
    ],
    placement: { player: 'yard', agent: 'hall' },
    spatial: {
      map: compiled.map,
      state: { doors: { ...compiled.initialDoors }, actors: { player: compiled.playerSpawn, agent: agentPosition } },
    },
  })
}

function seedFromWorld(world: WorldState): WorldSeed {
  return {
    rooms: Object.values(world.rooms).map((room) => ({ ...room })),
    actors: Object.values(world.actors).map((actor) => ({ ...actor })),
    placement: { ...world.location },
    spatial: { map: structuredClone(world.spatial!.map), state: structuredClone(world.spatial!.state) },
  }
}

describe('spatial orchestration integration', () => {
  it('rejects malformed spatial seeds and clones accepted map/state inputs', () => {
    const accepted = seedFromWorld(createSpatialWorld())
    const world = createWorld(accepted)
    accepted.spatial!.state.actors.player!.x += 1
    expect(world.spatial!.state.actors.player).not.toEqual(accepted.spatial!.state.actors.player)

    const malformedMap = seedFromWorld(createSpatialWorld())
    malformedMap.spatial!.map.tiles[1]![1] = 'floor'
    expect(() => createWorld(malformedMap)).toThrow(/spatial\.map/)
    const duplicateActor = seedFromWorld(createSpatialWorld())
    duplicateActor.actors = [...duplicateActor.actors, { ...duplicateActor.actors[0]! }]
    expect(() => createWorld(duplicateActor)).toThrow(/spatial\.state\.actors/)
    const missingActor = seedFromWorld(createSpatialWorld())
    delete (missingActor.spatial!.state.actors as Record<string, { x: number; y: number }>).agent
    expect(() => createWorld(missingActor)).toThrow(/spatial\.state\.actors/)
    const enclosureMismatch = seedFromWorld(createSpatialWorld())
    enclosureMismatch.rooms = enclosureMismatch.rooms.map((room) => room.id === 'yard' ? { ...room, enclosure: 'enclosed' as const } : room)
    expect(() => createWorld(enclosureMismatch)).toThrow(/enclosure/)
    const doorMismatch = seedFromWorld(createSpatialWorld())
    ;(doorMismatch.spatial!.state.doors as Record<string, 'open' | 'closed'>)['door:hall'] = 'open'
    expect(() => createWorld(doorMismatch)).toThrow(/doorOpen/)
  })

  it('initializes spatial state and walks a move intent without teleporting', () => {
    const world = createSpatialWorld()
    const initial = { ...world.spatial!.state.actors.player! }
    expect(world.spatial).toBeDefined()
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'move_room', toRoomId: 'hall' } })).toEqual({ ok: true })
    expect(world.location.player).toBe('yard')
    expect(world.spatial!.targets.player).toBe('hall')
    for (let step = 0; step < world.spatial!.map.width * world.spatial!.map.height; step += 1) {
      advanceSpatialMovement(world)
      if (world.location.player === 'hall') break
    }
    expect(world.location.player).toBe(OUTDOORS_ID)
    expect(world.spatial!.targets.player).toBe('hall')
    expect(world.spatial!.state.actors.player).not.toEqual(initial)

    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: true })
    for (let step = 0; step < world.spatial!.map.width * world.spatial!.map.height; step += 1) {
      advanceSpatialMovement(world)
      if (world.location.player === 'hall') break
    }
    expect(world.location.player).toBe('hall')
    expect(world.spatial!.targets.player).toBeUndefined()
  })

  it('accepts only adjacent outside knocks and rejects remote/outside door operations', () => {
    const remote = createSpatialWorld()
    expect(applyAction(remote, { actorKind: 'player', actorId: 'player', action: { type: 'knock', roomId: 'hall' } })).toEqual({ ok: false, reason: 'actor is not at the closed door outside' })
    expect(applyAction(remote, { actorKind: 'player', actorId: 'player', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: false, reason: 'only an actor inside an enclosed room may operate its door' })
    expect(applyAction(remote, { actorKind: 'player', actorId: 'player', action: { type: 'move_room', toRoomId: 'hall' } })).toEqual({ ok: true })
    for (let step = 0; step < remote.spatial!.map.width * remote.spatial!.map.height; step += 1) {
      advanceSpatialMovement(remote)
      const point = remote.spatial!.state.actors.player
      const door = remote.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
      if (point?.x === door.outside.x && point.y === door.outside.y) break
    }
    const remoteDoor = remote.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
    expect(remote.spatial!.state.actors.player).toEqual(remoteDoor.outside)
    expect(applyAction(remote, { actorKind: 'player', actorId: 'player', action: { type: 'knock', roomId: 'hall' } })).toEqual({ ok: true })
    expect(remote.transcript.at(-1)!.recipientIds).toEqual(['agent', 'player'])
  })

  it('displaces doorway actors and excludes them from immediate speech/evidence recipients', () => {
    const world = createSpatialWorld()
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: true })
    const door = world.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
    const pathToDoor = findPath(world.spatial!.map, world.spatial!.state.doors, world.spatial!.state.actors.player!, door.position)!
    for (const step of pathToDoor) expect(moveActorStep(world, 'player', step)).toEqual({ ok: true })
    expect(world.location.player).toBe('__doorway__')
    world.evidenceKnown.player = ['evidence']
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body: 'At the threshold', addresseeId: null } }).ok).toBe(false)
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'share_evidence', roomId: DOORWAY_ID, evidenceId: 'evidence' } }).ok).toBe(false)
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'close_door', roomId: 'hall' } })).toEqual({ ok: true })
    expect(world.location.player).toBe(OUTDOORS_ID)
    expect(world.presence.at(-1)?.roomId).toBe(OUTDOORS_ID)
  })

  it('builds generic outdoor and doorway inputs without closed-door narration', () => {
    const world = createSpatialWorld()
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: true })
    const target = { x: 1, y: 1 }
    const path = findPath(world.spatial!.map, world.spatial!.state.doors, world.spatial!.state.actors.agent!, target)!
    for (const step of path) moveActorStep(world, 'agent', step)
    const input = buildAgentTurnInput(world, 'agent', { sharedContext: 'context', stageBrief: 'brief', agents: { agent: { relevant: true, privateContext: { agentId: 'agent', motivations: [], secrets: [], knowledgeHorizon: 'now', notes: [] } } } }, 1)
    expect(input.room.id).toBe(OUTDOORS_ID)
    expect(input.room.enclosure).toBe('open')
    expect(input.room.doorOpen).toBe(true)
    expect(input.moveTargets?.map(({ id }) => id).sort()).toEqual(['hall', 'yard'])
    const door = world.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
    const doorwayPath = findPath(world.spatial!.map, world.spatial!.state.doors, world.spatial!.state.actors.player!, door.position)!
    for (const step of doorwayPath) moveActorStep(world, 'player', step)
    const doorwayInput = buildAgentTurnInput(world, 'player', { sharedContext: 'context', stageBrief: 'brief', agents: { player: { relevant: true, privateContext: { agentId: 'player', motivations: [], secrets: [], knowledgeHorizon: 'now', notes: [] } } } }, 1)
    const doorwayPrompt = buildAgentPrompt(doorwayInput)
    expect(doorwayPrompt.user).toContain('You are in a doorway. You cannot speak, share evidence, or hear conversations here; move into a space first.')
    expect(doorwayPrompt.user).not.toContain('The door is closed.')
  })

  it('limits outdoor recipients to three walking steps across named boundaries', () => {
    const world = createSpatialWorld()
    const yard = world.spatial!.map.rooms.find(({ id }) => id === 'yard')!
    expect(spaceAt(world.spatial!.map, { x: yard.x + 1, y: yard.y + 1 })).toEqual({ kind: 'outdoor', locationId: 'yard' })
    expect(spaceAt(world.spatial!.map, { x: 1, y: 1 })).toEqual({ kind: 'outdoor' })
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: true })
    for (const actorId of ['player', 'agent'] as const) {
      const target = { x: actorId === 'player' ? 1 : 5, y: 1 }
      const path = findPath(world.spatial!.map, world.spatial!.state.doors, world.spatial!.state.actors[actorId]!, target)!
      for (const step of path) moveActorStep(world, actorId, step)
    }
    expect(world.location.player).toBe(OUTDOORS_ID)
    expect(world.location.agent).toBe(OUTDOORS_ID)
    world.evidenceKnown.player = ['evidence']
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: OUTDOORS_ID, body: 'Far exchange', addresseeId: null } })).toEqual({ ok: true })
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'share_evidence', roomId: OUTDOORS_ID, evidenceId: 'evidence' } })).toEqual({ ok: true })
    expect(visibleTranscript(world, 'agent').map(({ body }) => body)).not.toContain('Far exchange')
    expect(world.evidenceKnown.agent).not.toContain('evidence')
    const near = { x: 4, y: 1 }
    const path = findPath(world.spatial!.map, world.spatial!.state.doors, world.spatial!.state.actors.agent!, near)!
    for (const step of path) moveActorStep(world, 'agent', step)
    expect(visibleTranscript(world, 'agent').map(({ body }) => body)).not.toContain('Far exchange')
    expect(world.evidenceKnown.agent).not.toContain('evidence')
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: OUTDOORS_ID, body: 'Near exchange', addresseeId: null } })).toEqual({ ok: true })
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'share_evidence', roomId: OUTDOORS_ID, evidenceId: 'evidence' } })).toEqual({ ok: true })
    expect(visibleTranscript(world, 'agent').map(({ body }) => body)).toContain('Near exchange')
    expect(world.evidenceKnown.agent).toContain('evidence')
  })

  it('keeps enclosed speech and evidence private from an outside adjacent listener', () => {
    const world = createSpatialWorld()
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: true })
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'move_room', toRoomId: 'hall' } })).toEqual({ ok: true })
    for (let step = 0; step < world.spatial!.map.width * world.spatial!.map.height && world.location.player !== 'hall'; step += 1) advanceSpatialMovement(world)
    const door = world.spatial!.map.doors.find(({ roomId }) => roomId === 'hall')!
    const outsidePath = findPath(world.spatial!.map, world.spatial!.state.doors, world.spatial!.state.actors.player!, door.outside)!
    for (const step of outsidePath) moveActorStep(world, 'player', step)
    world.evidenceKnown.agent = ['ledger']
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'speak', roomId: 'hall', body: 'Inside only', addresseeId: null } })).toEqual({ ok: true })
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'share_evidence', roomId: 'hall', evidenceId: 'ledger' } })).toEqual({ ok: true })
    expect(visibleTranscript(world, 'player').map(({ body }) => body)).not.toContain('Inside only')
    expect(world.evidenceKnown.player).not.toContain('ledger')
  })

  it('keeps manual spatial moves atomic and rejects spoofed actor kinds', () => {
    const world = createSpatialWorld()
    const before = structuredClone(world)
    expect(applyAction(world, { actorKind: 'agent', actorId: 'player', action: { type: 'yield' } })).toEqual({ ok: false, reason: 'actor kind does not match world actor' })
    expect(world.spatial!.state).toEqual(before.spatial!.state)
    const from = world.spatial!.state.actors.player!
    const invalid = moveActorStep(world, 'player', { x: from.x + 1, y: from.y + 1 })
    expect(invalid.ok).toBe(false)
    expect(world.seq).toBe(0)
    const destination = [{ x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y }, { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 }]
      .find((point) => isWalkable(world.spatial!.map, world.spatial!.state.doors, point))
    expect(destination).toBeDefined()
    expect(moveActorStep(world, 'player', destination!)).toEqual({ ok: true })
    expect(world.seq).toBe(1)
    expect(world.spatial!.targets.player).toBeUndefined()
  })

  it('stamps frozen spatial recipients and only accepts causal replies', () => {
    const world = createSpatialWorld()
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'open_door', roomId: 'hall' } })).toEqual({ ok: true })
    expect(applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'move_room', toRoomId: 'hall' } })).toEqual({ ok: true })
    for (let step = 0; step < world.spatial!.map.width * world.spatial!.map.height && world.location.player !== 'hall'; step += 1) advanceSpatialMovement(world)
    expect(world.location.player).toBe('hall')
    const request = applyAction(world, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: 'hall', body: 'Will you answer?', addresseeId: 'agent' } })
    expect(request).toEqual({ ok: true })
    const requestSeq = world.transcript.at(-1)!.seq
    expect(world.transcript.at(-1)!.recipientIds).toEqual(['agent', 'player'])
    expect(applyAction(world, { actorKind: 'agent', actorId: 'agent', action: { type: 'speak', roomId: 'hall', body: 'I answer.', addresseeId: 'player' } }, { replyToSeqs: [requestSeq] })).toEqual({ ok: true })
    expect(hasConversationExchange(world, 'player', 'agent')).toBe(true)
    expect(visibleTranscript(world, 'player').map(({ body }) => body)).toEqual(['Will you answer?', 'I answer.'])

    const outsider = createSpatialWorld()
    expect(applyAction(outsider, { actorKind: 'player', actorId: 'player', action: { type: 'speak', roomId: OUTDOORS_ID, body: 'Outside', addresseeId: null } })).toEqual({ ok: false, reason: 'cannot speak outside your current spatial location' })
  })
})
