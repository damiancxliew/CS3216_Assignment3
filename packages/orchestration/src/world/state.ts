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
import type { ActorAction } from '../actions'

export interface RoomState {
  id: string
  name: string
  description: string
  doorOpen: boolean
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
}

export interface WorldSeed {
  rooms: readonly RoomState[]
  actors: readonly ActorProfile[]
  /** actorId -> roomId at the start of the stage. */
  placement: Record<string, string>
  /** actorId -> evidence they already hold. */
  evidenceKnown?: Record<string, readonly string[]>
}

export interface WorldSeedIssue {
  roomId: string
  detail: string
}

export function validateWorldSeed(seed: WorldSeed): WorldSeedIssue[] {
  const actorIds = new Set(seed.actors.map((actor) => actor.id))
  const placedRooms = new Set(
    Object.entries(seed.placement)
      .filter(([actorId]) => actorIds.has(actorId))
      .map(([, roomId]) => roomId),
  )
  return seed.rooms
    .filter((room) => !room.doorOpen && !placedRooms.has(room.id))
    .map((room) => ({
      roomId: room.id,
      detail: `closed room "${room.id}" has no actor placed inside`,
    }))
}

export function createWorld(seed: WorldSeed): WorldState {
  const issues = validateWorldSeed(seed)
  if (issues.length > 0) {
    throw new Error(`Invalid world seed: ${issues.map((issue) => issue.detail).join('; ')}`)
  }
  const world: WorldState = {
    tick: 0,
    seq: 0,
    rooms: Object.fromEntries(seed.rooms.map((room) => [room.id, { ...room }])),
    actors: Object.fromEntries(seed.actors.map((actor) => [actor.id, { ...actor }])),
    location: { ...seed.placement },
    transcript: [],
    presence: [],
    evidenceKnown: Object.fromEntries(
      seed.actors.map((actor) => [actor.id, [...(seed.evidenceKnown?.[actor.id] ?? [])]]),
    ),
    privateNotes: Object.fromEntries(seed.actors.filter((a) => a.kind === 'agent').map((a) => [a.id, []])),
    events: [],
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

/**
 * Apply one allow-listed action to the world. Returns a refusal rather than throwing when the
 * world does not permit it (walking through a closed door, speaking in a room you are not in) —
 * a refused action is a recorded event, not a failed turn.
 */
export function applyAction(world: WorldState, entry: ActorAction): ApplyResult {
  const { actorId, action } = entry
  const actor = world.actors[actorId]
  if (actor === undefined) return refuse(world, actorId, '', `unknown actor "${actorId}"`)
  const here = world.location[actorId] ?? ''

  switch (action.type) {
    case 'speak': {
      if (action.roomId !== here) return refuse(world, actorId, here, 'cannot speak in a room you are not in')
      world.transcript.push({
        tick: world.tick,
        seq: nextSeq(world),
        roomId: here,
        speakerId: actorId,
        speakerName: actor.name,
        addresseeId: action.addresseeId,
        body: action.body,
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
      room.doorOpen = action.type === 'open_door'
      world.events.push({ tick: world.tick, actorId, kind: action.type, roomId: here, detail: room.name })
      return { ok: true }
    }
    case 'knock': {
      const target = world.rooms[action.roomId]
      if (target === undefined) return refuse(world, actorId, action.roomId, `no such room "${action.roomId}"`)
      if (action.roomId === here) return refuse(world, actorId, here, 'cannot knock from inside your own room')
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
  return world.transcript.filter((line) => wasPresent(world, actorId, line.roomId, line.seq))
}
