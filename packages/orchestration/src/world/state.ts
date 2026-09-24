/**
 * Server-authoritative world state for one stage (K3, PRD FR-11 / FR-12 / D7).
 *
 * This is the thing that makes room-scoped visibility a property of the system rather than an
 * instruction to a model. Every utterance is stamped with the room and the tick it happened on,
 * and presence is logged per tick, so "what may this agent know" is answered by a join over facts
 * the server recorded — never by trusting an agent not to use what it was shown.
 *
 * A closed door is the privacy mechanism (D7): it blocks movement in and out, so an exchange in a
 * closed room is heard only by the actors who were already inside. A knock is written to the
 * target room's transcript, allowing its occupants to decide whether to open the door.
 *
 * State transitions live here and nowhere else. Actions arrive already allow-listed
 * (`filterActions`); this module decides whether the *world* permits them.
 */
import { canHearSpeech, closeSpatialDoor, isWalkable, moveActor, spaceAt, validateStageMap, walkActorTowardRoom } from '@adventure/game-core'
import type { Point, SpatialState, StageMap } from '@adventure/game-core'
import type { ActorAction } from '../actions'

export interface SpatialWorldState {
  map: StageMap
  state: SpatialState
  targets: Record<string, string>
}

export interface RoomState {
  id: string
  name: string
  description: string
  doorOpen: boolean
  enclosure?: 'enclosed' | 'open'
}

export interface ActorProfile {
  id: string
  name: string
  /** What everyone in the room can see. Private context lives with the agent runtime, not here. */
  publicRole: string
  kind: 'agent' | 'player'
}

export interface Utterance {
  tick: number
  /** Position in the world's action sequence. Visibility is decided against this, not the tick. */
  seq: number
  roomId: string
  speakerId: string
  speakerName: string
  addresseeId: string | null
  body: string
  recipientIds?: string[]
  replyToSeqs?: number[]
  goalIds?: string[]
}

/**
 * A span during which an actor stood in a room, half-open as `[fromSeq, toSeq)`. Intervals rather
 * than per-tick snapshots because several things happen inside one tick: an agent that says
 * something and then leaves must still be the only one who heard what was said after the door shut.
 */
export interface PresenceEntry {
  actorId: string
  roomId: string
  fromSeq: number
  toSeq: number | null
}

/** A change to the world that the debrief and the Resolver can read back (FR-19). */
export interface WorldEvent {
  tick: number
  actorId: string
  kind: 'move_room' | 'open_door' | 'close_door' | 'knock' | 'share_evidence' | 'speak' | 'refused'
  roomId: string
  detail: string
}

export interface WorldState {
  tick: number
  /** Monotonic counter over every world-changing action. */
  seq: number
  rooms: Record<string, RoomState>
  actors: Record<string, ActorProfile>
  /** actorId -> roomId. The only source of truth for who is where. */
  location: Record<string, string>
  /** Append-only. Room- and tick-stamped, which is what makes visibility computable. */
  transcript: Utterance[]
  presence: PresenceEntry[]
  /** actorId -> evidence ids they have learned, in order. */
  evidenceKnown: Record<string, string[]>
  /** agentId -> notes the agent wrote itself. Server-side only, never projected (FR-21). */
  privateNotes: Record<string, string[]>
  events: WorldEvent[]
  spatial?: SpatialWorldState
}

export interface WorldSeed {
  rooms: readonly RoomState[]
  actors: readonly ActorProfile[]
  /** actorId -> roomId at the start of the stage. */
  placement: Record<string, string>
  /** actorId -> evidence they already hold. */
  evidenceKnown?: Record<string, readonly string[]>
  spatial?: { map: StageMap; state: SpatialState }
}

export const OUTDOORS_ID = '__outdoors__'
export const DOORWAY_ID = '__doorway__'

export interface WorldSeedIssue {
  roomId: string
  detail: string
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === left.length && rightSet.size === right.length && leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id))
}

function spatialLocation(map: StageMap, point: Point): string | null {
  const space = spaceAt(map, point)
  if (space === null) return null
  if (space.kind === 'room') return space.roomId
  if (space.kind === 'door') return DOORWAY_ID
  return space.locationId ?? OUTDOORS_ID
}

function validateSpatialSeed(seed: WorldSeed): string[] {
  const supplied = seed.spatial
  if (supplied === undefined) return []
  if (supplied.map === null || typeof supplied.map !== 'object' || !Array.isArray(supplied.map.rooms) || !Array.isArray(supplied.map.doors)) return ['spatial.map: invalid map payload']
  if (supplied.state === null || typeof supplied.state !== 'object' || Array.isArray(supplied.state) || supplied.state.actors === null || typeof supplied.state.actors !== 'object' || Array.isArray(supplied.state.actors) || supplied.state.doors === null || typeof supplied.state.doors !== 'object' || Array.isArray(supplied.state.doors)) return ['spatial.state: expected actors and doors records']
  const errors: string[] = []
  const mapResult = validateStageMap(supplied.map)
  errors.push(...mapResult.errors.map((error) => `spatial.map: ${error}`))
  if (errors.length > 0) return errors
  const mapRoomIds = supplied.map.rooms.map((room) => room.id)
  const seedRoomIds = seed.rooms.map((room) => room.id)
  if (!sameIds(mapRoomIds, seedRoomIds)) errors.push('spatial: map and seed room ids must match exactly')
  for (const room of seed.rooms) {
    const mapRoom = supplied.map.rooms.find((candidate) => candidate.id === room.id)
    if (mapRoom !== undefined && room.enclosure !== mapRoom.enclosure) errors.push(`rooms.${room.id}: enclosure does not match spatial map`)
    if (mapRoom?.enclosure === 'open' && !room.doorOpen) errors.push(`rooms.${room.id}: open location must be doorOpen`)
    const door = supplied.map.doors.find((candidate) => candidate.roomId === room.id)
    if (door !== undefined && ((supplied.state.doors[door.id] === 'open') !== room.doorOpen)) errors.push(`rooms.${room.id}: doorOpen does not match spatial door state`)
  }
  const actorIds = seed.actors.map((actor) => actor.id)
  const spatialActorIds = Object.keys(supplied.state.actors)
  if (!sameIds(actorIds, spatialActorIds)) errors.push('spatial.state.actors: ids must match seed actors exactly')
  const doorIds = supplied.map.doors.map((door) => door.id)
  const stateDoorIds = Object.keys(supplied.state.doors)
  if (!sameIds(doorIds, stateDoorIds)) errors.push('spatial.state.doors: keys must match map doors exactly')
  for (const doorId of stateDoorIds) {
    if (supplied.state.doors[doorId] !== 'open' && supplied.state.doors[doorId] !== 'closed') errors.push(`spatial.state.doors.${doorId}: invalid door state`)
  }
  if (!sameIds(actorIds, Object.keys(seed.placement))) errors.push('placement: ids must match seed actors exactly in spatial mode')
  for (const actor of seed.actors) {
    const point = supplied.state.actors[actor.id]
    if (point === undefined) continue
    if (!isWalkable(supplied.map, supplied.state.doors, point)) errors.push(`spatial.state.actors.${actor.id}: position is not walkable`)
    const expected = seed.placement[actor.id]
    const actual = spatialLocation(supplied.map, point)
    if (expected === undefined || actual !== expected) errors.push(`spatial.state.actors.${actor.id}: position does not match placement ${expected ?? '(missing)'}`)
  }
  return errors
}

function spatialInitialization(seed: WorldSeed): SpatialWorldState | undefined {
  if (seed.spatial === undefined) return undefined
  const map = structuredClone(seed.spatial.map)
  const state = structuredClone(seed.spatial.state)
  return { map, state, targets: {} }
}

export function validateWorldSeed(seed: WorldSeed): WorldSeedIssue[] {
  const actorIds = new Set(seed.actors.map((actor) => actor.id))
  const placedRooms = new Set(
    Object.entries(seed.placement)
      .filter(([actorId]) => actorIds.has(actorId))
      .map(([, roomId]) => roomId),
  )
  return seed.rooms
    .filter((room) => !room.doorOpen && room.enclosure !== 'open' && !placedRooms.has(room.id))
    .map((room) => ({
      roomId: room.id,
      detail: `closed room "${room.id}" has no actor placed inside`,
    }))
}

export function createWorld(seed: WorldSeed): WorldState {
  const issues = validateWorldSeed(seed)
  const spatialIssues = validateSpatialSeed(seed)
  if (issues.length > 0 || spatialIssues.length > 0) {
    throw new Error(`Invalid world seed: ${[...issues.map((issue) => issue.detail), ...spatialIssues].join('; ')}`)
  }
  const spatial = spatialInitialization(seed)
  const location = spatial === undefined
    ? { ...seed.placement }
    : Object.fromEntries(Object.entries(spatial.state.actors).map(([actorId, point]) => [actorId, spatialLocation(spatial.map, point)!]))
  const world: WorldState = {
    tick: 0,
    seq: 0,
    rooms: Object.fromEntries(seed.rooms.map((room) => [room.id, { ...room }])),
    actors: Object.fromEntries(seed.actors.map((actor) => [actor.id, { ...actor }])),
    location,
    transcript: [],
    presence: [],
    evidenceKnown: Object.fromEntries(
      seed.actors.map((actor) => [actor.id, [...(seed.evidenceKnown?.[actor.id] ?? [])]]),
    ),
    privateNotes: Object.fromEntries(seed.actors.filter((a) => a.kind === 'agent').map((a) => [a.id, []])),
    events: [],
    ...(spatial === undefined ? {} : { spatial }),
  }
  for (const [actorId, roomId] of Object.entries(world.location)) {
    world.presence.push({ actorId, roomId, fromSeq: 0, toSeq: null })
  }
  return world
}

function nextSeq(world: WorldState): number {
  world.seq += 1
  return world.seq
}

/** Ticks order the loop and label events; they play no part in who heard what. */
export function advanceTick(world: WorldState): void {
  world.tick += 1
  if (world.spatial !== undefined) advanceSpatialMovement(world)
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y
}

function updateSpatialPosition(world: WorldState, actorId: string, nextState: SpatialState, from: Point): boolean {
  const spatial = world.spatial
  if (spatial === undefined) return false
  const to = nextState.actors[actorId]
  if (to === undefined || samePoint(from, to)) return false
  const previousLocation = world.location[actorId] ?? ''
  const nextLocation = spatialLocation(spatial.map, to)
  if (nextLocation === null) return false
  const seq = nextSeq(world)
  spatial.state = nextState
  world.location[actorId] = nextLocation
  if (previousLocation !== nextLocation) {
    for (const entry of world.presence) {
      if (entry.actorId === actorId && entry.toSeq === null) entry.toSeq = seq
    }
    world.presence.push({ actorId, roomId: nextLocation, fromSeq: seq, toSeq: null })
  }
  world.events.push({ tick: world.tick, actorId, kind: 'move_room', roomId: nextLocation, detail: `from ${previousLocation}` })
  return true
}

export function hearingActorIds(world: WorldState, speakerId: string): string[] {
  if (world.actors[speakerId] === undefined) return []
  if (world.spatial === undefined) return occupantsOf(world, world.location[speakerId] ?? '').map(({ id }) => id).sort()
  const speakerPoint = world.spatial.state.actors[speakerId]
  if (speakerPoint === undefined) return []
  return Object.keys(world.actors)
    .filter((actorId) => actorId === speakerId || (world.spatial?.state.actors[actorId] !== undefined && canHearSpeech(world.spatial.map, speakerPoint, world.spatial.state.actors[actorId]!)))
    .sort()
}

export function moveActorStep(world: WorldState, actorId: string, to: Point): ApplyResult {
  const spatial = world.spatial
  if (spatial === undefined) return refuse(world, actorId, world.location[actorId] ?? '', 'spatial movement is not enabled')
  const from = spatial.state.actors[actorId]
  if (from === undefined || world.actors[actorId] === undefined) return refuse(world, actorId, world.location[actorId] ?? '', `unknown actor "${actorId}"`)
  const next = moveActor(spatial.map, spatial.state, actorId, to)
  if (next === spatial.state) return refuse(world, actorId, world.location[actorId] ?? '', 'invalid spatial step')
  delete spatial.targets[actorId]
  updateSpatialPosition(world, actorId, next, from)
  return { ok: true }
}

export function advanceSpatialMovement(world: WorldState): void {
  const spatial = world.spatial
  if (spatial === undefined) return
  for (const actorId of Object.keys(spatial.targets).sort()) {
    const targetId = spatial.targets[actorId]
    const from = spatial.state.actors[actorId]
    if (targetId === undefined || from === undefined) {
      delete spatial.targets[actorId]
      continue
    }
    const result = walkActorTowardRoom(spatial.map, spatial.state, actorId, targetId)
    const moved = result.state !== spatial.state && result.state.actors[actorId] !== undefined && !samePoint(from, result.state.actors[actorId]!)
    if (moved) updateSpatialPosition(world, actorId, result.state, from)
    if (result.status === 'arrived' || result.status === 'unreachable') delete spatial.targets[actorId]
  }
}

export function occupantsOf(world: WorldState, roomId: string): ActorProfile[] {
  return Object.entries(world.location)
    .filter(([, room]) => room === roomId)
    .map(([actorId]) => world.actors[actorId])
    .filter((actor): actor is ActorProfile => actor !== undefined)
}

export type ApplyResult = { ok: true } | { ok: false; reason: string }

function refuse(world: WorldState, actorId: string, roomId: string, reason: string): ApplyResult {
  world.events.push({ tick: world.tick, actorId, kind: 'refused', roomId, detail: reason })
  return { ok: false, reason }
}

export interface ActionContext {
  replyToSeqs?: readonly number[]
}

function lineHasRecipient(world: WorldState, line: Utterance, actorId: string): boolean {
  if (line.recipientIds !== undefined) return line.recipientIds.includes(actorId)
  return world.spatial === undefined && wasPresent(world, actorId, line.roomId, line.seq)
}

function validReplySeqs(world: WorldState, actorId: string, seqs: readonly number[]): number[] | null {
  const unique = [...new Set(seqs)]
  if (unique.some((seq) => !Number.isInteger(seq) || seq > world.seq)) return null
  for (const seq of unique) {
    const line = world.transcript.find((candidate) => candidate.seq === seq)
    if (line === undefined || world.actors[line.speakerId]?.kind !== 'player' || line.addresseeId !== actorId || !lineHasRecipient(world, line, actorId)) return null
  }
  return unique.sort((left, right) => left - right)
}

function commitSpatialState(world: WorldState, nextState: SpatialState): void {
  const spatial = world.spatial
  if (spatial === undefined) return
  const seq = nextSeq(world)
  for (const actorId of Object.keys(world.actors)) {
    const before = spatial.state.actors[actorId]
    const after = nextState.actors[actorId]
    if (before === undefined || after === undefined || samePoint(before, after)) continue
    const nextLocation = spatialLocation(spatial.map, after)
    if (nextLocation === null) continue
    const previousLocation = world.location[actorId] ?? ''
    world.location[actorId] = nextLocation
    if (previousLocation !== nextLocation) {
      for (const entry of world.presence) {
        if (entry.actorId === actorId && entry.toSeq === null) entry.toSeq = seq
      }
      world.presence.push({ actorId, roomId: nextLocation, fromSeq: seq, toSeq: null })
    }
    world.events.push({ tick: world.tick, actorId, kind: 'move_room', roomId: nextLocation, detail: `from ${previousLocation}` })
  }
  spatial.state = nextState
}

function spatialDoorFor(world: WorldState, roomId: string) {
  return world.spatial?.map.doors.find((door) => door.roomId === roomId)
}

function applySpatialAction(world: WorldState, entry: ActorAction, context: ActionContext): ApplyResult {
  const spatial = world.spatial!
  const { actorId, action } = entry
  const actor = world.actors[actorId]!
  const here = world.location[actorId] ?? ''
  switch (action.type) {
    case 'speak': {
      if (here === DOORWAY_ID || action.roomId !== here) return refuse(world, actorId, here, 'cannot speak outside your current spatial location')
      const recipients = hearingActorIds(world, actorId)
      if (action.addresseeId !== null && !recipients.includes(action.addresseeId)) return refuse(world, actorId, here, 'addressee cannot hear speech')
      const replyToSeqs = context.replyToSeqs === undefined ? undefined : validReplySeqs(world, actorId, context.replyToSeqs)
      if (context.replyToSeqs !== undefined && (actor.kind !== 'agent' || replyToSeqs === null)) return refuse(world, actorId, here, 'invalid reply source')
      const seq = nextSeq(world)
      world.transcript.push({
        tick: world.tick,
        seq,
        roomId: here,
        speakerId: actorId,
        speakerName: actor.name,
        addresseeId: action.addresseeId,
        body: action.body,
        recipientIds: recipients,
        ...(replyToSeqs === undefined || replyToSeqs === null || replyToSeqs.length === 0 ? {} : { replyToSeqs }),
      })
      world.events.push({ tick: world.tick, actorId, kind: 'speak', roomId: here, detail: action.body })
      return { ok: true }
    }
    case 'move_room': {
      if (spatial.map.rooms.every((room) => room.id !== action.toRoomId)) return refuse(world, actorId, here, `no such room "${action.toRoomId}"`)
      spatial.targets[actorId] = action.toRoomId
      world.events.push({ tick: world.tick, actorId, kind: 'move_room', roomId: action.toRoomId, detail: `target from ${here}` })
      return { ok: true }
    }
    case 'open_door':
    case 'close_door': {
      const room = spatial.map.rooms.find((candidate) => candidate.id === action.roomId)
      const door = spatialDoorFor(world, action.roomId)
      const point = spatial.state.actors[actorId]
      if (room === undefined || room.enclosure !== 'enclosed' || door === undefined || point === undefined || here !== room.id || spaceAt(spatial.map, point)?.kind !== 'room') {
        return refuse(world, actorId, here, 'only an actor inside an enclosed room may operate its door')
      }
      const state = { doors: { ...spatial.state.doors, [door.id]: action.type === 'open_door' ? 'open' as const : 'closed' as const }, actors: spatial.state.actors }
      if (action.type === 'close_door') {
        commitSpatialState(world, closeSpatialDoor(spatial.map, state, door.id))
      } else {
        commitSpatialState(world, state)
      }
      world.rooms[action.roomId]!.doorOpen = action.type === 'open_door'
      world.events.push({ tick: world.tick, actorId, kind: action.type, roomId: action.roomId, detail: room.id })
      return { ok: true }
    }
    case 'knock': {
      const target = spatial.map.rooms.find((room) => room.id === action.roomId)
      const door = spatialDoorFor(world, action.roomId)
      const point = spatial.state.actors[actorId]
      if (target === undefined || target.enclosure !== 'enclosed' || door === undefined || point === undefined) return refuse(world, actorId, action.roomId, `no such closed enclosed door "${action.roomId}"`)
      if (spatial.state.doors[door.id] !== 'closed' || !samePoint(point, door.outside)) return refuse(world, actorId, target.id, 'actor is not at the closed door outside')
      const recipients = Object.keys(world.actors).filter((id) => {
        const position = spatial.state.actors[id]
        const space = position === undefined ? null : spaceAt(spatial.map, position)
        return id === actorId || (space?.kind === 'room' && space.roomId === target.id)
      }).sort()
      const body = `${actor.name} knocks.`
      world.transcript.push({ tick: world.tick, seq: nextSeq(world), roomId: target.id, speakerId: actorId, speakerName: actor.name, addresseeId: null, body, recipientIds: recipients })
      world.events.push({ tick: world.tick, actorId, kind: 'knock', roomId: target.id, detail: body })
      return { ok: true }
    }
    case 'share_evidence': {
      if (here === DOORWAY_ID) return refuse(world, actorId, here, 'cannot share evidence from a doorway')
      if (action.roomId !== here) return refuse(world, actorId, here, 'cannot share evidence in another spatial location')
      if (!(world.evidenceKnown[actorId] ?? []).includes(action.evidenceId)) return refuse(world, actorId, here, `does not hold evidence "${action.evidenceId}"`)
      for (const recipientId of hearingActorIds(world, actorId)) {
        const known = world.evidenceKnown[recipientId] ?? (world.evidenceKnown[recipientId] = [])
        if (!known.includes(action.evidenceId)) known.push(action.evidenceId)
      }
      world.events.push({ tick: world.tick, actorId, kind: 'share_evidence', roomId: here, detail: action.evidenceId })
      return { ok: true }
    }
    case 'record_private_note': {
      const notes = world.privateNotes[actorId] ?? (world.privateNotes[actorId] = [])
      notes.push(action.note)
      return { ok: true }
    }
    case 'commit_decision':
    case 'pass':
    case 'yield':
      return { ok: true }
  }
}

/**
 * Apply one allow-listed action to the world. Returns a refusal rather than throwing when the
 * world does not permit it (walking through a closed door, speaking in a room you are not in) —
 * a refused action is a recorded event, not a failed turn.
 */
export function applyAction(world: WorldState, entry: ActorAction, context: ActionContext = {}): ApplyResult {
  const { actorId, action } = entry
  const actor = world.actors[actorId]
  if (actor === undefined) return refuse(world, actorId, '', `unknown actor "${actorId}"`)
  if (actor.kind !== entry.actorKind) return refuse(world, actorId, world.location[actorId] ?? '', 'actor kind does not match world actor')
  if (world.spatial !== undefined) return applySpatialAction(world, entry, context)
  const here = world.location[actorId] ?? ''

  switch (action.type) {
    case 'speak': {
      if (action.roomId !== here) return refuse(world, actorId, here, 'cannot speak in a room you are not in')
      const replyToSeqs = context.replyToSeqs === undefined ? undefined : validReplySeqs(world, actorId, context.replyToSeqs)
      if (context.replyToSeqs !== undefined && (actor.kind !== 'agent' || replyToSeqs === null)) return refuse(world, actorId, here, 'invalid reply source')
      world.transcript.push({
        tick: world.tick,
        seq: nextSeq(world),
        roomId: here,
        speakerId: actorId,
        speakerName: actor.name,
        addresseeId: action.addresseeId,
        body: action.body,
        recipientIds: hearingActorIds(world, actorId),
        ...(replyToSeqs === undefined || replyToSeqs === null || replyToSeqs.length === 0 ? {} : { replyToSeqs }),
      })
      world.events.push({ tick: world.tick, actorId, kind: 'speak', roomId: here, detail: action.body })
      return { ok: true }
    }
    case 'move_room': {
      const target = world.rooms[action.toRoomId]
      if (target === undefined) return refuse(world, actorId, here, `no such room "${action.toRoomId}"`)
      const from = world.rooms[here]
      if (from !== undefined && !from.doorOpen) return refuse(world, actorId, here, 'the door of this room is closed')
      if (!target.doorOpen) return refuse(world, actorId, here, `the door of "${target.id}" is closed`)
      const seq = nextSeq(world)
      for (const entry of world.presence) {
        if (entry.actorId === actorId && entry.toSeq === null) entry.toSeq = seq
      }
      world.location[actorId] = target.id
      world.presence.push({ actorId, roomId: target.id, fromSeq: seq, toSeq: null })
      world.events.push({ tick: world.tick, actorId, kind: 'move_room', roomId: target.id, detail: `from ${here}` })
      return { ok: true }
    }
    case 'open_door':
    case 'close_door': {
      if (action.roomId !== here) return refuse(world, actorId, here, 'cannot work a door you are not at')
      const room = world.rooms[here]
      if (room === undefined) return refuse(world, actorId, here, `no such room "${here}"`)
      if (room.enclosure === 'open') return refuse(world, actorId, here, 'open locations have no door')
      room.doorOpen = action.type === 'open_door'
      world.events.push({ tick: world.tick, actorId, kind: action.type, roomId: here, detail: room.name })
      return { ok: true }
    }
    case 'knock': {
      const target = world.rooms[action.roomId]
      if (target === undefined) return refuse(world, actorId, action.roomId, `no such room "${action.roomId}"`)
      if (action.roomId === here) return refuse(world, actorId, here, 'cannot knock from inside your own room')
      if (target.enclosure === 'open') return refuse(world, actorId, target.id, 'open locations have no door')
      if (target.doorOpen) return refuse(world, actorId, target.id, `door to "${target.id}" is already open`)
      const body = `${actor.name} knocks.`
      world.transcript.push({
        tick: world.tick,
        seq: nextSeq(world),
        roomId: target.id,
        speakerId: actorId,
        speakerName: actor.name,
        addresseeId: null,
        body,
      })
      world.events.push({ tick: world.tick, actorId, kind: 'knock', roomId: target.id, detail: body })
      return { ok: true }
    }
    case 'share_evidence': {
      if (action.roomId !== here) return refuse(world, actorId, here, 'cannot share evidence in another room')
      if (!(world.evidenceKnown[actorId] ?? []).includes(action.evidenceId)) {
        return refuse(world, actorId, here, `does not hold evidence "${action.evidenceId}"`)
      }
      for (const occupant of occupantsOf(world, here)) {
        const known = world.evidenceKnown[occupant.id] ?? (world.evidenceKnown[occupant.id] = [])
        if (!known.includes(action.evidenceId)) known.push(action.evidenceId)
      }
      world.events.push({
        tick: world.tick,
        actorId,
        kind: 'share_evidence',
        roomId: here,
        detail: action.evidenceId,
      })
      return { ok: true }
    }
    case 'record_private_note': {
      const notes = world.privateNotes[actorId] ?? (world.privateNotes[actorId] = [])
      notes.push(action.note)
      return { ok: true }
    }
    case 'commit_decision':
    case 'pass':
    case 'yield':
      // Turn-level actions: the turn loop and the Resolver own these, the world has no state for them.
      return { ok: true }
  }
}

/** Was this actor standing in this room at this point in the sequence? */
export function wasPresent(world: WorldState, actorId: string, roomId: string, seq: number): boolean {
  return world.presence.some(
    (entry) =>
      entry.actorId === actorId &&
      entry.roomId === roomId &&
      entry.fromSeq <= seq &&
      (entry.toSeq === null || seq < entry.toSeq),
  )
}

/**
 * The transcript this actor may know: lines spoken in rooms it was standing in at the time (K3).
 * An exchange it walked in on after the fact is not in here, and neither is anything said behind a
 * door it was on the wrong side of.
 */
export function visibleTranscript(world: WorldState, actorId: string): Utterance[] {
  return world.transcript.filter((line) => lineHasRecipient(world, line, actorId))
}

export function hasConversationExchange(world: WorldState, playerId: string, agentId: string, objectiveId?: string): boolean {
  if (world.actors[playerId]?.kind !== 'player' || world.actors[agentId]?.kind !== 'agent') return false
  return world.transcript.some((request) => {
    if (request.speakerId !== playerId || request.addresseeId !== agentId || !lineHasRecipient(world, request, agentId)) return false
    return world.transcript.some((reply) => {
      const speaker = world.actors[reply.speakerId]
      return speaker?.kind === 'agent' && reply.speakerId === agentId && reply.seq > request.seq && reply.replyToSeqs?.includes(request.seq) === true && lineHasRecipient(world, reply, playerId) && (objectiveId === undefined || reply.goalIds?.includes(objectiveId) === true)
    })
  })
}
