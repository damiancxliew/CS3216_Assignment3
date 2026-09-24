import {
  closeSpatialDoor,
  compileStage,
  findPath,
  isWalkable,
  moveActor,
  projectMap,
  spaceAt,
  walkActorTowardRoom,
  type DoorState,
  type Point,
  type Space,
  type SpatialState,
  type StageMap,
} from '@adventure/game-core'
import { actorNames, playgroundFixture } from './fixture.js'

export type PlayerGoal = { kind: 'point'; point: Point } | { kind: 'room'; roomId: string } | null
export type TravelStatus = 'idle' | 'moving' | 'arrived' | 'waiting_for_door' | 'unreachable'
export type AmbientOverlayId = 'clear' | 'clouds' | 'rain' | 'fog' | 'night' | 'dust' | 'snow'
export type MapThemeId = 'classic' | 'desert' | 'winter' | 'forest' | 'coast'
export type SceneEffectId = 'explosion' | 'fire' | 'smoke' | 'confetti' | 'flash' | 'rubble' | 'crowd_cheer' | 'crowd_flee'

export interface PlaygroundSnapshot {
  seed: string
  map: StageMap
  doors: Record<string, DoorState>
  actors: Array<{
    id: string
    name: string
    position: Point
    space: Space | null
    targetRoomId: string | null
    status: TravelStatus
    /** Character sheet key for a tiled renderer; ignored by the primitive one. */
    sprite?: string
    /** Realistic generated portrait shown as the actor's in-world avatar when available. */
    portraitUrl?: string | null
    /** Whether the host considers this actor close enough to interact with now. */
    interactive?: boolean
    /** Which way the actor last moved, for a walk cycle. */
    facing?: 'down' | 'up' | 'left' | 'right'
  }>
  /** Documents and objects lying on the map, drawn where the compiler placed them. */
  props?: Array<{ id: string; name: string; position: Point; found: boolean; imageUrl?: string }>
  /** Optional public, non-actor markers supplied by a host application. */
  evidence?: Array<{ id: string; name: string; roomId: string; examined: boolean; position: Point }>
  playerGoal: PlayerGoal
  playerStatus: TravelStatus
  running: boolean
  npcRoutes: boolean
  revision: number
  /** Display names for rooms, when the caller has them; the demo fixture's names are the fallback. */
  roomNames?: Readonly<Record<string, string>>
  mapTheme?: MapThemeId
  /** Generated artwork for named, inspectable map landmarks. */
  roomImages?: Readonly<Record<string, string>>
  /** Physical, inspectable fixtures placed within named rooms. */
  landmarks?: Array<{ id: string; roomId: string; name: string; position: Point; imageUrl?: string }>
  /** Stage atmosphere (FR-15a) and one-shot effects to play (FR-15b), for renderers that support them. */
  ambient?: { id: AmbientOverlayId; intensity: 1 | 2 | 3 }
  effects?: Array<{ key: string; id: SceneEffectId; roomId?: string | null }>
  /** Sound: whether it is on, and keyed one-shot cues to play once each. */
  audio?: { muted: boolean; cues?: Array<{ key: string; id: SoundCueId }> }
}

export type SoundCueId = 'accept' | 'evidence' | 'resolution' | 'alert' | 'refused' | 'door' | 'step'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export class PlaygroundModel {
  private seedValue: string
  private mapValue: StageMap
  private spatial: SpatialState
  private playerGoalValue: PlayerGoal = null
  private playerStatusValue: TravelStatus = 'idle'
  private actorStatus: Record<string, TravelStatus> = {}
  private npcTargets: Record<string, string> = {}
  private npcPending: Record<string, boolean> = {}
  private runningValue = true
  private npcRoutesValue = true
  private revisionValue = 0

  constructor(seed = 'harbor-demo') {
    const next = this.construct(seed)
    this.seedValue = next.seed
    this.mapValue = next.map
    this.spatial = next.spatial
    this.actorStatus = next.actorStatus
    this.npcTargets = next.npcTargets
    this.npcPending = next.npcPending
  }

  snapshot(): PlaygroundSnapshot {
    const actorIds = Object.keys(this.spatial.actors).sort(compareIds)
    return {
      seed: this.seedValue,
      map: clone(this.mapValue),
      doors: { ...this.spatial.doors },
      actors: actorIds.map((id) => {
        const position = this.spatial.actors[id]!
        return {
          id,
          name: actorNames[id] ?? id,
          position: { x: position.x, y: position.y },
          space: spaceAt(this.mapValue, position),
          targetRoomId: id === 'player' ? null : this.npcTargets[id] ?? null,
          status: id === 'player' ? this.playerStatusValue : this.actorStatus[id] ?? 'idle',
        }
      }),
      playerGoal: clone(this.playerGoalValue),
      playerStatus: this.playerStatusValue,
      running: this.runningValue,
      npcRoutes: this.npcRoutesValue,
      revision: this.revisionValue,
    }
  }

  reset(seed: string): void {
    const next = this.construct(seed)
    this.seedValue = next.seed
    this.mapValue = next.map
    this.spatial = next.spatial
    this.playerGoalValue = null
    this.playerStatusValue = 'idle'
    this.actorStatus = next.actorStatus
    this.npcTargets = next.npcTargets
    this.npcPending = next.npcPending
    this.runningValue = true
    this.npcRoutesValue = true
    this.revisionValue = 0
  }

  setRunning(running: boolean): void {
    if (this.runningValue === running) return
    this.runningValue = running
    this.revisionValue += 1
  }

  setNpcRoutes(enabled: boolean): void {
    if (this.npcRoutesValue === enabled) return
    this.npcRoutesValue = enabled
    this.revisionValue += 1
  }

  navigateToRoom(roomId: string): void {
    if (!this.mapValue.rooms.some(({ id }) => id === roomId)) return
    const current = this.spatial.actors.player!
    const currentSpace = spaceAt(this.mapValue, current)
    if (currentSpace?.kind === 'room' && currentSpace.roomId === roomId) {
      this.playerGoalValue = null
      this.playerStatusValue = 'arrived'
    } else {
      this.playerGoalValue = { kind: 'room', roomId }
      this.playerStatusValue = 'moving'
    }
    this.revisionValue += 1
  }

  navigateToPoint(point: Point): void {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || !isWalkable(this.mapValue, this.spatial.doors, point)) {
      this.playerGoalValue = null
      this.playerStatusValue = 'unreachable'
      this.revisionValue += 1
      return
    }
    const current = this.spatial.actors.player!
    if (current.x === point.x && current.y === point.y) {
      this.playerGoalValue = null
      this.playerStatusValue = 'arrived'
    } else {
      this.playerGoalValue = { kind: 'point', point: { x: point.x, y: point.y } }
      this.playerStatusValue = 'moving'
    }
    this.revisionValue += 1
  }

  movePlayer(dx: number, dy: number): void {
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return
    const from = this.spatial.actors.player!
    const next = moveActor(this.mapValue, this.spatial, 'player', { x: from.x + dx, y: from.y + dy })
    if (next === this.spatial) {
      this.playerGoalValue = null
      this.playerStatusValue = 'idle'
      this.revisionValue += 1
      return
    }
    this.spatial = next
    this.playerGoalValue = null
    this.playerStatusValue = 'idle'
    this.revisionValue += 1
  }

  stopPlayer(): void {
    if (this.playerGoalValue === null && this.playerStatusValue === 'idle') return
    this.playerGoalValue = null
    this.playerStatusValue = 'idle'
    this.revisionValue += 1
  }

  toggleDoor(doorId: string): void {
    if (!this.mapValue.doors.some(({ id }) => id === doorId)) return
    const current = this.spatial.doors[doorId]
    if (current === 'open') {
      this.spatial = closeSpatialDoor(this.mapValue, this.spatial, doorId)
    } else {
      this.spatial = { doors: { ...this.spatial.doors, [doorId]: 'open' }, actors: this.spatial.actors }
    }
    this.refreshPlayerStatus()
    this.revisionValue += 1
  }

  step(): void {
    this.advancePlayer()
    if (this.npcRoutesValue) this.advanceNpcs()
    this.revisionValue += 1
  }

  private construct(seed: string): {
    seed: string
    map: StageMap
    spatial: SpatialState
    actorStatus: Record<string, TravelStatus>
    npcTargets: Record<string, string>
    npcPending: Record<string, boolean>
  } {
    const compiled = compileStage(playgroundFixture, seed)
    const map = projectMap(compiled)
    const actors: Record<string, Point> = { player: { x: compiled.playerSpawn.x, y: compiled.playerSpawn.y } }
    for (const placement of compiled.placements) {
      if (placement.kind === 'actor') actors[placement.id] = { x: placement.position.x, y: placement.position.y }
    }
    const roomIds = map.rooms.map(({ id }) => id).sort(compareIds)
    const actorStatus: Record<string, TravelStatus> = {}
    const npcTargets: Record<string, string> = {}
    const npcPending: Record<string, boolean> = {}
    for (const id of Object.keys(actors).sort(compareIds)) {
      actorStatus[id] = 'idle'
      if (id === 'player') continue
      const current = spaceAt(map, actors[id]!)
      const currentIndex = current?.kind === 'room' ? roomIds.indexOf(current.roomId) : -1
      npcTargets[id] = roomIds[(currentIndex + 1 + roomIds.length) % roomIds.length]!
      npcPending[id] = false
    }
    return {
      seed,
      map,
      spatial: { doors: { ...compiled.initialDoors }, actors },
      actorStatus,
      npcTargets,
      npcPending,
    }
  }

  private advancePlayer(): void {
    if (this.playerGoalValue?.kind === 'room') {
      const result = walkActorTowardRoom(this.mapValue, this.spatial, 'player', this.playerGoalValue.roomId)
      this.spatial = result.state
      this.playerStatusValue = result.status
      if (result.status === 'arrived') this.playerGoalValue = null
      return
    }
    if (this.playerGoalValue?.kind === 'point') {
      const from = this.spatial.actors.player!
      const path = findPath(this.mapValue, this.spatial.doors, from, this.playerGoalValue.point)
      if (path === null) {
        this.playerGoalValue = null
        this.playerStatusValue = 'unreachable'
      } else if (path.length === 0) {
        this.playerGoalValue = null
        this.playerStatusValue = 'arrived'
      } else {
        this.spatial = moveActor(this.mapValue, this.spatial, 'player', path[0]!)
        this.playerGoalValue = path.length === 1 ? null : this.playerGoalValue
        this.playerStatusValue = path.length === 1 ? 'arrived' : 'moving'
      }
    }
  }

  private advanceNpcs(): void {
    const ids = Object.keys(this.npcTargets).sort(compareIds)
    const roomIds = this.mapValue.rooms.map(({ id }) => id).sort(compareIds)
    for (const id of ids) {
      if (this.npcPending[id]) {
        const current = spaceAt(this.mapValue, this.spatial.actors[id]!)
        const currentIndex = current?.kind === 'room' ? roomIds.indexOf(current.roomId) : -1
        this.npcTargets[id] = roomIds[(currentIndex + 1 + roomIds.length) % roomIds.length]!
        this.npcPending[id] = false
      }
      const result = walkActorTowardRoom(this.mapValue, this.spatial, id, this.npcTargets[id]!)
      this.spatial = result.state
      this.actorStatus[id] = result.status
      if (result.status === 'arrived') this.npcPending[id] = true
    }
  }

  private refreshPlayerStatus(): void {
    const goal = this.playerGoalValue
    if (!goal) return
    const position = this.spatial.actors.player!
    if (goal.kind === 'point') {
      const path = findPath(this.mapValue, this.spatial.doors, position, goal.point)
      if (path === null) {
        this.playerGoalValue = null
        this.playerStatusValue = 'unreachable'
      } else if (path.length === 0) {
        this.playerGoalValue = null
        this.playerStatusValue = 'arrived'
      } else {
        this.playerStatusValue = 'moving'
      }
      return
    }
    const current = spaceAt(this.mapValue, position)
    if (current?.kind === 'room' && current.roomId === goal.roomId) {
      this.playerGoalValue = null
      this.playerStatusValue = 'arrived'
      return
    }
    const targetDoor = this.mapValue.doors.find(({ roomId }) => roomId === goal.roomId)
    if (!targetDoor) {
      this.playerGoalValue = null
      this.playerStatusValue = 'unreachable'
      return
    }
    const open = isWalkable(this.mapValue, this.spatial.doors, targetDoor.position)
    if (!open && position.x === targetDoor.outside.x && position.y === targetDoor.outside.y) {
      this.playerStatusValue = 'waiting_for_door'
      return
    }
    const path = findPath(this.mapValue, this.spatial.doors, position, open ? targetDoor.inside : targetDoor.outside)
    this.playerStatusValue = path === null ? 'unreachable' : 'moving'
  }
}
