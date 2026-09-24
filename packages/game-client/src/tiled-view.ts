/**
 * Tileset renderer: the same `MapView` contract as `view.ts`, drawn from a curated
 * 16px pack instead of primitives. Terrain, walls, doors, characters and effects
 * are hand-drawn assets (PRD D4); this file only decides which tile goes where.
 *
 * Expects, under `assetBase`:
 *   tiles/floor.png     ground autotiles (22 columns)     tiles/wall.png      room walls (10 columns)
 *   tiles/interior.png  plank floors (22 columns)         tiles/house.png     door frames (33 columns)
 *   characters/<Sprite>/walk.png   4 columns = down/up/left/right, 4 rows = frames
 *   fx/rain.png fx/snow.png (8px frames), fx/fog.png, fx/clouds.png, fx/smoke.png (32px frames)
 */
import Phaser from 'phaser'
import { spaceAt, type Point, type StageMap } from '@adventure/game-core'
import { tileFromPointer } from './pointer.js'
import type { PlaygroundSnapshot, SoundCueId } from './model.js'
import type { MapView } from './view.js'

const T = 16

// Ground (floor.png, 22 columns). Path autotile keyed by which neighbours are also path: N=1 E=2 S=4 W=8.
const FLOOR_COLS = 22
const at = (cols: number) => (c: number, r: number) => r * cols + c
const F = at(FLOOR_COLS)
const GRASS = [F(0, 12), F(0, 12), F(0, 12), F(0, 12), F(1, 12), F(2, 12), F(3, 12), F(4, 12), F(2, 11), F(3, 11)]
const PATH: Record<number, number> = {
  0: F(3, 10),
  1: F(3, 9),
  4: F(3, 7),
  5: F(3, 8),
  2: F(0, 10),
  8: F(2, 10),
  10: F(1, 10),
  6: F(0, 7),
  12: F(2, 7),
  3: F(0, 9),
  9: F(2, 9),
  7: F(0, 8),
  13: F(2, 8),
  14: F(1, 7),
  11: F(1, 9),
  15: F(1, 8),
}
// Walls (wall.png, 10 columns): the brown room block at columns 0-4, rows 6-10.
const W = at(10)
const WALL = { tl: W(0, 6), t: W(1, 6), tr: W(4, 6), l: W(0, 7), r: W(4, 7), bl: W(0, 10), b: W(1, 10), br: W(4, 10) }
// Interior planks (interior.png, 22 columns).
const I = at(22)
const PLANKS = [I(12, 1), I(12, 1), I(13, 1), I(12, 2), I(13, 2)]
// Doors (house.png, 33 columns).
const H = at(33)
const DOOR = { closed: H(2, 3), open: H(9, 3) }

/** One track per atmosphere (FR-15a), from the pack's CC0 soundtrack; the ending has its own. */
const MUSIC_FOR: Record<string, string> = {
  clear: 'calm-village',
  clouds: 'road',
  rain: 'quiet',
  fog: 'mystical',
  night: 'quiet',
  dust: 'tension',
  snow: 'peaceful',
}
const AMBIENT_LOOP: Partial<Record<string, string>> = { rain: 'rain', dust: 'wind', clouds: 'wind', snow: 'wind' }
const SFX: readonly SoundCueId[] = ['accept', 'evidence', 'resolution', 'alert', 'refused', 'door', 'step']
const MUSIC_VOLUME = 0.35

const DIRECTIONS = ['down', 'up', 'left', 'right'] as const
/** One tile takes exactly this long, so a walk of many tiles is one unbroken slide. */
const STEP_MS = 160
type Facing = (typeof DIRECTIONS)[number]

function jitter(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1274126177) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export interface TiledViewOptions {
  assetBase: string
  /** Sprite key to use for an actor that does not name one. */
  defaultSprite?: string
  /** Called when the player clicks a character instead of a tile. */
  onActor?: (actorId: string) => void
  /** Called when the player clicks a document or object lying on the map. */
  onProp?: (propId: string) => void
}

class TiledScene extends Phaser.Scene {
  private current: PlaygroundSnapshot
  private readonly onDestination: (point: Point, inputAt?: number) => void
  private readonly onReady: () => void
  private readonly base: string
  private readonly defaultSprite: string
  private readonly onActor: ((actorId: string) => void) | undefined
  private readonly onProp: ((propId: string) => void) | undefined
  private reducedMotion: boolean
  private ready = false
  private map?: Phaser.Tilemaps.Tilemap
  private ground?: Phaser.Tilemaps.TilemapLayer
  private floors?: Phaser.Tilemaps.TilemapLayer
  private walls?: Phaser.Tilemaps.TilemapLayer
  private doors = new Map<string, Phaser.GameObjects.Image>()
  private labels: Phaser.GameObjects.Text[] = []
  private markers = new Map<
    string,
    {
      container: Phaser.GameObjects.Container
      sprite: Phaser.GameObjects.Sprite
      label: Phaser.GameObjects.Text
      hint: Phaser.GameObjects.Text | null
      hintTween: Phaser.Tweens.Tween | null
      labelAbove: boolean
      key: string
      facing: Facing
      last: Point
      /** Pending "stop walking": re-armed by each step, so a continuous walk keeps its animation. */
      idle: Phaser.Time.TimerEvent | null
    }
  >()
  private props = new Map<string, { container: Phaser.GameObjects.Container; hint: Phaser.GameObjects.Text; tween: Phaser.Tweens.Tween | null; found: boolean }>()
  /** Tiles whose nameplate would land on a door, i.e. the tile above each door. */
  private plateBlocked = new Set<string>()
  private loadedSprites = new Set<string>()
  private ambientId: string | null = null
  private ambientObjects: Phaser.GameObjects.GameObject[] = []
  private playedEffects = new Set<string>()
  private playedCues = new Set<string>()
  private music: Phaser.Sound.BaseSound | null = null
  private musicKey: string | null = null
  private ambientLoop: Phaser.Sound.BaseSound | null = null
  private ambientLoopKey: string | null = null
  private following = false

  constructor(snapshot: PlaygroundSnapshot, onDestination: (point: Point, inputAt?: number) => void, reducedMotion: boolean, onReady: () => void, options: TiledViewOptions) {
    super({ key: 'tiled-map' })
    this.current = snapshot
    this.onDestination = onDestination
    this.reducedMotion = reducedMotion
    this.onReady = onReady
    this.base = options.assetBase.replace(/\/$/, '')
    this.defaultSprite = options.defaultSprite ?? 'Villager'
    this.onActor = options.onActor
    this.onProp = options.onProp
  }

  preload(): void {
    this.load.image('tiles-floor', `${this.base}/tiles/floor.png`)
    this.load.image('tiles-wall', `${this.base}/tiles/wall.png`)
    this.load.image('tiles-interior', `${this.base}/tiles/interior.png`)
    this.load.spritesheet('house', `${this.base}/tiles/house.png`, { frameWidth: T, frameHeight: T })
    this.load.spritesheet('fx-rain', `${this.base}/fx/rain.png`, { frameWidth: 8, frameHeight: 8 })
    this.load.spritesheet('fx-snow', `${this.base}/fx/snow.png`, { frameWidth: 8, frameHeight: 8 })
    this.load.spritesheet('fx-smoke', `${this.base}/fx/smoke.png`, { frameWidth: 32, frameHeight: 32 })
    this.load.image('fx-fog', `${this.base}/fx/fog.png`)
    this.load.image('fx-clouds', `${this.base}/fx/clouds.png`)
    for (const key of this.spriteKeys(this.current)) this.queueSprite(key)
    for (const track of new Set(Object.values(MUSIC_FOR))) this.load.audio(`music-${track}`, `${this.base}/audio/music/${track}.ogg`)
    for (const loop of new Set(Object.values(AMBIENT_LOOP))) if (loop) this.load.audio(`loop-${loop}`, `${this.base}/audio/sfx/${loop}.ogg`)
    for (const cue of SFX) this.load.audio(`sfx-${cue}`, `${this.base}/audio/sfx/${cue}.ogg`)
  }

  create(): void {
    this.ready = true
    for (const key of this.spriteKeys(this.current)) this.registerAnimations(key)
    this.buildMap()
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const point = tileFromPointer(pointer.worldX, pointer.worldY, T, this.current.map.width, this.current.map.height)
      if (!point) return
      // A character under the pointer means "talk to them", not "walk here".
      const actor = this.current.actors.find((a) => a.id !== 'player' && a.position.x === point.x && a.position.y === point.y)
      if (actor && this.onActor) {
        this.onActor(actor.id)
        return
      }
      // A document under the pointer means "go read it", not "walk here".
      const prop = (this.current.props ?? []).find((p) => p.position.x === point.x && p.position.y === point.y)
      if (prop && this.onProp) {
        this.onProp(prop.id)
        return
      }
      this.onDestination(point, pointer.time || performance.now())
      this.game.canvas.focus()
    })
    this.game.canvas.tabIndex = 0
    this.game.canvas.setAttribute('aria-label', 'Settlement map')
    this.scale.on('resize', () => this.fitCamera())
    // Browsers keep audio silent until the user has interacted; the sound manager unlocks itself on
    // the first gesture, and the music starts then.
    if (this.sound.locked) this.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.applyAudio(this.current))
    this.renderSnapshot(this.current, true)
    this.fitCamera()
    queueMicrotask(this.onReady)
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
    if (!this.ready) return
    this.tweens.killAll()
    this.ambientId = null
    this.renderSnapshot(this.current, true)
  }

  apply(snapshot: PlaygroundSnapshot): void {
    const previous = this.current
    this.current = snapshot
    if (!this.ready) return
    const mapChanged = snapshot.map.id !== previous.map.id
    if (mapChanged) {
      this.tweens.killAll()
      this.buildMap()
      this.playedEffects.clear()
    }
    const missing = this.spriteKeys(snapshot).filter((key) => !this.loadedSprites.has(key))
    if (missing.length > 0) {
      for (const key of missing) this.queueSprite(key)
      this.load.once('complete', () => {
        for (const key of missing) this.registerAnimations(key)
        this.renderSnapshot(this.current, mapChanged)
      })
      this.load.start()
    }
    this.renderSnapshot(snapshot, mapChanged || snapshot.revision < previous.revision)
    if (mapChanged) this.fitCamera()
  }

  // ---------------------------------------------------------------------------

  private spriteKeys(snapshot: PlaygroundSnapshot): string[] {
    return [...new Set(snapshot.actors.map((a) => a.sprite ?? this.defaultSprite))]
  }

  private queueSprite(key: string): void {
    if (this.loadedSprites.has(key)) return
    this.loadedSprites.add(key)
    this.load.spritesheet(`char-${key}`, `${this.base}/characters/${key}/walk.png`, { frameWidth: T, frameHeight: T })
  }

  private registerAnimations(key: string): void {
    if (!this.textures.exists(`char-${key}`)) return
    DIRECTIONS.forEach((facing, column) => {
      const anim = `char-${key}-${facing}`
      if (this.anims.exists(anim)) return
      this.anims.create({
        key: anim,
        frames: [0, 1, 2, 3].map((row) => ({ key: `char-${key}`, frame: row * 4 + column })),
        frameRate: 8,
        repeat: -1,
      })
    })
  }

  private buildMap(): void {
    this.map?.destroy()
    this.plateBlocked = new Set(this.current.map.doors.map((door) => `${door.position.x},${door.position.y - 1}`))
    this.doors.forEach((d) => d.destroy())
    this.doors.clear()
    this.labels.forEach((l) => l.destroy())
    this.labels = []
    this.markers.forEach((m) => m.container.destroy())
    this.markers.clear()
    this.props.forEach((p) => p.container.destroy())
    this.props.clear()
    this.clearAmbient()

    const source = this.current.map
    const map = this.make.tilemap({ tileWidth: T, tileHeight: T, width: source.width, height: source.height })
    const floorSet = map.addTilesetImage('tiles-floor', 'tiles-floor', T, T, 0, 0)!
    const wallSet = map.addTilesetImage('tiles-wall', 'tiles-wall', T, T, 0, 0)!
    const interiorSet = map.addTilesetImage('tiles-interior', 'tiles-interior', T, T, 0, 0)!
    this.ground = map.createBlankLayer('ground', floorSet)!.setDepth(0)
    this.floors = map.createBlankLayer('floors', interiorSet)!.setDepth(1)
    this.walls = map.createBlankLayer('walls', wallSet)!.setDepth(2)
    this.map = map

    const isPath = (x: number, y: number) => source.tiles[y]?.[x] === 'path'
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const tile = source.tiles[y]![x]!
        // Everything sits on grass; the outer border is drawn as a wall ring by the room pass below.
        this.ground.putTileAt(GRASS[Math.floor(jitter(x, y, 1) * GRASS.length)]!, x, y)
        if (tile === 'path') {
          const mask = (isPath(x, y - 1) ? 1 : 0) | (isPath(x + 1, y) ? 2 : 0) | (isPath(x, y + 1) ? 4 : 0) | (isPath(x - 1, y) ? 8 : 0)
          this.ground.putTileAt(PATH[mask] ?? PATH[15]!, x, y)
        }
      }
    }
    for (const room of source.rooms) {
      if (room.enclosure === 'enclosed') {
        const x1 = room.x + room.width - 1
        const y1 = room.y + room.height - 1
        for (let y = room.y; y <= y1; y += 1) {
          for (let x = room.x; x <= x1; x += 1) {
            const edgeX = x === room.x ? 'l' : x === x1 ? 'r' : null
            const edgeY = y === room.y ? 't' : y === y1 ? 'b' : null
            if (!edgeX && !edgeY) {
              this.floors.putTileAt(PLANKS[Math.floor(jitter(x, y, 2) * PLANKS.length)]!, x, y)
              continue
            }
            this.floors.putTileAt(PLANKS[0]!, x, y) // under the door tile
            const index = edgeX && edgeY ? WALL[`${edgeY}${edgeX}` as 'tl' | 'tr' | 'bl' | 'br'] : edgeX ? WALL[edgeX] : WALL[edgeY as 't' | 'b']
            this.walls.putTileAt(index, x, y)
          }
        }
      }
      // A door on the top wall keeps the room name outside the room, above the wall.
      const doorOnTopWall = source.doors.some((door) => door.roomId === room.id && door.position.y === room.y)
      this.labels.push(
        this.add
          .text((room.x + room.width / 2) * T, doorOnTopWall ? room.y * T - 1 : room.y * T + 1, this.roomName(room.id), {
            color: '#fff8e7',
            fontFamily: 'system-ui, "Segoe UI", sans-serif',
            fontSize: '9px',
            fontStyle: 'bold',
            backgroundColor: '#2e2620',
            padding: { x: 4, y: 2 },
            resolution: 8,
          })
          .setOrigin(0.5, doorOnTopWall ? 1 : 0)
          .setDepth(30)
          .setAlpha(0.95),
      )
    }
    // Map border: a wall ring so the world has an edge.
    for (let x = 0; x < source.width; x += 1) {
      if (source.tiles[0]?.[x] === 'wall') this.walls.putTileAt(WALL.t, x, 0)
      if (source.tiles[source.height - 1]?.[x] === 'wall') this.walls.putTileAt(WALL.b, x, source.height - 1)
    }
    for (let y = 0; y < source.height; y += 1) {
      if (source.tiles[y]?.[0] === 'wall') this.walls.putTileAt(WALL.l, 0, y)
      if (source.tiles[y]?.[source.width - 1] === 'wall') this.walls.putTileAt(WALL.r, source.width - 1, y)
    }
    if (source.tiles[0]?.[0] === 'wall') this.walls.putTileAt(WALL.tl, 0, 0)
    if (source.tiles[0]?.[source.width - 1] === 'wall') this.walls.putTileAt(WALL.tr, source.width - 1, 0)
    if (source.tiles[source.height - 1]?.[0] === 'wall') this.walls.putTileAt(WALL.bl, 0, source.height - 1)
    if (source.tiles[source.height - 1]?.[source.width - 1] === 'wall') this.walls.putTileAt(WALL.br, source.width - 1, source.height - 1)

    for (const door of source.doors) {
      this.walls.removeTileAt(door.position.x, door.position.y)
      const image = this.add.image(door.position.x * T + T / 2, door.position.y * T + T / 2, 'house', DOOR.closed).setDepth(3)
      this.doors.set(door.id, image)
    }
  }

  private renderSnapshot(snapshot: PlaygroundSnapshot, snap = false): void {
    for (const door of snapshot.map.doors) this.doors.get(door.id)?.setFrame(snapshot.doors[door.id] === 'open' ? DOOR.open : DOOR.closed)

    const playerSpace = snapshot.actors.find((a) => a.id === 'player')?.space
    const playerRoomId = playerSpace?.kind === 'room' ? playerSpace.roomId : null
    this.renderProps(snapshot, playerRoomId)
    const occupied = new Map<string, number>()
    for (const actor of snapshot.actors) {
      const key = actor.sprite ?? this.defaultSprite
      const positionKey = `${actor.position.x},${actor.position.y}`
      const offset = occupied.get(positionKey) ?? 0
      occupied.set(positionKey, offset + 1)
      const x = actor.position.x * T + T / 2 + (offset === 0 ? 0 : Math.round(Math.cos(offset * (Math.PI / 3)) * 5))
      const y = actor.position.y * T + T / 2 + (offset === 0 ? 0 : Math.round(Math.sin(offset * (Math.PI / 3)) * 5))

      let marker = this.markers.get(actor.id)
      if (marker && marker.key !== key) {
        marker.container.destroy()
        marker = undefined
      }
      if (!marker) {
        marker = this.createMarker(actor.id === 'player', actor.name, key, actor.position)
        this.markers.set(actor.id, marker)
        marker.container.setPosition(x, y)
      }
      const dx = actor.position.x - marker.last.x
      const dy = actor.position.y - marker.last.y
      const moved = dx !== 0 || dy !== 0
      const facing: Facing = actor.facing ?? (moved ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up') : marker.facing)
      marker.facing = facing
      marker.last = { x: actor.position.x, y: actor.position.y }
      const animKey = `char-${key}-${facing}`
      if (moved && !this.reducedMotion && this.anims.exists(animKey)) {
        const walker = marker
        marker.sprite.play(animKey, true)
        marker.idle?.remove()
        marker.idle = this.time.delayedCall(STEP_MS + 100, () => {
          walker.idle = null
          if (!walker.sprite.active) return
          if (walker.sprite.anims.currentAnim?.key === animKey && walker.sprite.anims.isPlaying) walker.sprite.stop()
          if (this.textures.exists(`char-${key}`)) walker.sprite.setFrame(DIRECTIONS.indexOf(facing))
        })
      } else if (marker.idle === null && this.textures.exists(`char-${key}`)) {
        marker.sprite.setFrame(DIRECTIONS.indexOf(facing))
      }
      marker.container.setDepth(10 + actor.position.y / 1000 + (actor.id === 'player' ? 0.5 : 0))
      // A nameplate below the feet would sit on the door the character is standing at.
      this.placeLabel(marker, this.plateBlocked.has(`${actor.position.x},${actor.position.y}`))
      // Someone you can talk to right now gets a prompt above their head.
      marker.hint?.setVisible(playerRoomId !== null && actor.space?.kind === 'room' && actor.space.roomId === playerRoomId)
      if (snap || this.reducedMotion) {
        this.tweens.killTweensOf(marker.container)
        marker.container.setPosition(x, y)
      } else if (marker.container.x !== x || marker.container.y !== y) {
        this.tweens.killTweensOf(marker.container)
        this.tweens.add({ targets: marker.container, x, y, duration: STEP_MS, ease: 'Linear' })
      }
    }
    for (const [id, marker] of this.markers) {
      if (!snapshot.actors.some((a) => a.id === id)) {
        marker.container.destroy()
        this.markers.delete(id)
      }
    }
    this.applyAmbient(snapshot)
    this.playEffects(snapshot)
    this.applyAudio(snapshot)
    this.followPlayer()
  }

  /**
   * Documents lying on the map: a parchment tile the player can walk to and click.
   * One that has been read keeps its place but stops asking to be read.
   */
  private renderProps(snapshot: PlaygroundSnapshot, playerRoomId: string | null): void {
    const props = snapshot.props ?? []
    for (const prop of props) {
      let entry = this.props.get(prop.id)
      if (!entry) {
        entry = this.createProp(prop.name)
        this.props.set(prop.id, entry)
      }
      entry.container.setPosition(prop.position.x * T + T / 2, prop.position.y * T + T / 2)
      entry.container.setDepth(9 + prop.position.y / 1000)
      if (entry.found !== prop.found) {
        entry.found = prop.found
        entry.container.setAlpha(prop.found ? 0.55 : 1)
        if (prop.found) {
          entry.tween?.remove()
          entry.tween = null
        }
      }
      const space = spaceAt(snapshot.map, prop.position)
      const inPlayerRoom = playerRoomId !== null && space?.kind === 'room' && space.roomId === playerRoomId
      entry.hint.setVisible(!prop.found && inPlayerRoom)
    }
    for (const [id, entry] of this.props) {
      if (!props.some((p) => p.id === id)) {
        entry.container.destroy()
        this.props.delete(id)
      }
    }
  }

  private createProp(name: string) {
    const container = this.add.container(0, 0)
    const shadow = this.add.ellipse(0, 5, 10, 4, 0x000000, 0.25)
    const sheet = this.add.rectangle(0, 0, 10, 12, 0xf6e7c1).setStrokeStyle(1, 0x6b563a)
    const lines = [-3, 0, 3].map((offset) => this.add.rectangle(0, offset, 6, 1, 0x8a7550))
    const label = this.add
      .text(0, 8, name, {
        color: '#2e2620',
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: '6px',
        fontStyle: 'bold',
        backgroundColor: '#f2dfae',
        padding: { x: 3, y: 1 },
        resolution: 8,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.95)
    const hint = this.add
      .text(0, -10, 'click to read', {
        color: '#2e2620',
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: '6px',
        fontStyle: 'bold',
        backgroundColor: '#ffe9a8',
        padding: { x: 3, y: 1 },
        resolution: 8,
      })
      .setOrigin(0.5, 1)
      .setVisible(false)
    container.add([shadow, sheet, ...lines, label, hint])
    const tween = this.reducedMotion ? null : this.tweens.add({ targets: hint, y: -12, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    return { container, hint, tween, found: false }
  }

  /** Nameplate under the feet by default, flipped over the head where it would cover a door. */
  private placeLabel(marker: { label: Phaser.GameObjects.Text; hint: Phaser.GameObjects.Text | null; hintTween: Phaser.Tweens.Tween | null; labelAbove: boolean }, above: boolean): void {
    if (marker.labelAbove === above) return
    marker.labelAbove = above
    marker.label.setOrigin(0.5, above ? 1 : 0).setY(above ? -9 : 9)
    if (!marker.hint) return
    const hintY = above ? -9 - marker.label.height : -13
    marker.hintTween?.remove()
    marker.hintTween = null
    marker.hint.setY(hintY)
    if (!this.reducedMotion) marker.hintTween = this.tweens.add({ targets: marker.hint, y: hintY - 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  private createMarker(player: boolean, name: string, key: string, position: Point) {
    const container = this.add.container(0, 0)
    const shadow = this.add.ellipse(0, 6, 10, 4, 0x000000, 0.25)
    const textureKey = this.textures.exists(`char-${key}`) ? `char-${key}` : this.textures.exists(`char-${this.defaultSprite}`) ? `char-${this.defaultSprite}` : '__DEFAULT'
    const sprite = this.add.sprite(0, 0, textureKey, 0).setOrigin(0.5, 0.5)
    const label = this.add
      .text(0, 9, name, {
        color: '#fff8e7',
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: '7px',
        fontStyle: 'bold',
        backgroundColor: player ? '#2f6f73' : '#3a2a24',
        padding: { x: 3, y: 1 },
        resolution: 8,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.95)
    let hint: Phaser.GameObjects.Text | null = null
    let hintTween: Phaser.Tweens.Tween | null = null
    if (!player) {
      hint = this.add
        .text(0, -13, 'click to talk', {
          color: '#2e2620',
          fontFamily: 'system-ui, "Segoe UI", sans-serif',
          fontSize: '6px',
          fontStyle: 'bold',
          backgroundColor: '#ffe9a8',
          padding: { x: 3, y: 1 },
          resolution: 8,
        })
        .setOrigin(0.5, 1)
        .setVisible(false)
      if (!this.reducedMotion) hintTween = this.tweens.add({ targets: hint, y: -15, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    }
    container.add(hint ? [shadow, sprite, label, hint] : [shadow, sprite, label])
    return { container, sprite, label, hint, hintTween, labelAbove: false, key, facing: 'down' as Facing, last: { x: position.x, y: position.y }, idle: null }
  }

  // ---------------------------------------------------------------------------
  // camera

  private fitCamera(): void {
    if (!this.ready) return
    const cam = this.cameras.main
    const mapW = this.current.map.width * T
    const mapH = this.current.map.height * T
    const { width, height } = this.scale.gameSize
    // Fill the viewport: the map is scaled to fit whichever dimension binds, never below 2x so
    // sprites stay legible; beyond that the camera follows the player.
    const fit = Math.min(width / mapW, height / mapH)
    const zoom = Math.max(2, Math.min(5, Math.round(fit * 4) / 4))
    cam.setZoom(zoom)
    cam.setRoundPixels(true)
    if (mapW * zoom <= width && mapH * zoom <= height) {
      cam.stopFollow()
      cam.removeBounds()
      cam.centerOn(mapW / 2, mapH / 2)
      this.following = false
    } else {
      cam.setBounds(0, 0, mapW, mapH)
      this.following = true
      this.followPlayer(true)
    }
  }

  private followPlayer(force = false): void {
    if (!this.following) return
    const player = this.markers.get('player')
    if (!player) return
    const cam = this.cameras.main
    if (force || (cam as { _follow?: unknown })._follow !== player.container) cam.startFollow(player.container, true, 0.15, 0.15)
  }

  // ---------------------------------------------------------------------------
  // atmosphere (FR-15a) and effects (FR-15b)

  private clearAmbient(): void {
    this.ambientObjects.forEach((o) => o.destroy())
    this.ambientObjects = []
    this.ambientId = null
  }

  private applyAmbient(snapshot: PlaygroundSnapshot): void {
    const ambient = snapshot.ambient ?? { id: 'clear' as const, intensity: 1 as const }
    const signature = `${ambient.id}:${ambient.intensity}:${this.reducedMotion}`
    if (signature === this.ambientId) return
    this.clearAmbient()
    this.ambientId = signature
    const mapW = snapshot.map.width * T
    const mapH = snapshot.map.height * T
    const strength = ambient.intensity / 3
    const keep = (o: Phaser.GameObjects.GameObject) => {
      this.ambientObjects.push(o)
      return o
    }
    switch (ambient.id) {
      case 'night':
        keep(this.add.rectangle(mapW / 2, mapH / 2, mapW * 2, mapH * 2, 0x0b1a3a, 0.16 + 0.1 * strength).setDepth(40))
        break
      case 'fog': {
        const fog = this.add.tileSprite(mapW / 2, mapH / 2, mapW * 2, mapH * 2, 'fx-fog').setDepth(40).setAlpha(0.14 + 0.14 * strength)
        keep(fog)
        if (!this.reducedMotion) keep(this.tweens.add({ targets: fog, tilePositionX: 320, duration: 40_000, repeat: -1 }) as unknown as Phaser.GameObjects.GameObject)
        break
      }
      case 'clouds': {
        keep(this.add.rectangle(mapW / 2, mapH / 2, mapW * 2, mapH * 2, 0x203040, 0.04 + 0.04 * strength).setDepth(40))
        for (let i = 0; i < 2 + ambient.intensity; i += 1) {
          const cloud = this.add.image(jitter(i, 7, 3) * mapW, jitter(i, 9, 4) * mapH, 'fx-clouds').setDepth(41).setAlpha(0.18).setTint(0x1a2430).setScale(2)
          keep(cloud)
          if (!this.reducedMotion) keep(this.tweens.add({ targets: cloud, x: cloud.x + mapW, duration: 60_000 + i * 9000, repeat: -1 }) as unknown as Phaser.GameObjects.GameObject)
        }
        break
      }
      case 'rain':
      case 'snow':
      case 'dust': {
        keep(this.add.rectangle(mapW / 2, mapH / 2, mapW * 2, mapH * 2, ambient.id === 'dust' ? 0x8a6b3a : 0x1b2a3a, 0.05 + 0.05 * strength).setDepth(40))
        if (this.reducedMotion) break
        const texture = ambient.id === 'rain' ? 'fx-rain' : 'fx-snow'
        const emitter = this.add.particles(0, 0, texture, {
          x: { min: -mapW * 0.2, max: mapW * 1.2 },
          y: -T,
          frame: ambient.id === 'rain' ? [0, 1, 2] : [0, 1, 2, 3, 4, 5, 6],
          lifespan: ambient.id === 'rain' ? 1400 : 5000,
          speedY: ambient.id === 'rain' ? { min: 180, max: 260 } : ambient.id === 'snow' ? { min: 14, max: 28 } : { min: 4, max: 10 },
          speedX: ambient.id === 'rain' ? 30 : ambient.id === 'dust' ? { min: 40, max: 90 } : { min: -8, max: 8 },
          quantity: ambient.intensity,
          frequency: ambient.id === 'rain' ? 16 : 60,
          alpha: ambient.id === 'dust' ? { start: 0.5, end: 0 } : { start: 0.9, end: 0.4 },
          ...(ambient.id === 'dust' ? { tint: 0xc9a86a } : {}),
          scale: ambient.id === 'dust' ? 0.6 : 1,
        })
        emitter.setDepth(42)
        keep(emitter)
        break
      }
      default:
        break
    }
  }

  private playEffects(snapshot: PlaygroundSnapshot): void {
    for (const effect of snapshot.effects ?? []) {
      if (this.playedEffects.has(effect.key)) continue
      this.playedEffects.add(effect.key)
      const room = effect.roomId ? snapshot.map.rooms.find((r) => r.id === effect.roomId) : undefined
      const cam = this.cameras.main
      const x = room ? (room.x + room.width / 2) * T : cam.midPoint.x
      const y = room ? (room.y + room.height / 2) * T : cam.midPoint.y
      if (this.reducedMotion) {
        cam.flash(120, 255, 255, 255, false)
        continue
      }
      switch (effect.id) {
        case 'flash':
          cam.flash(320)
          break
        case 'explosion':
          cam.shake(320, 0.006)
          cam.flash(200, 255, 220, 160)
          this.puff(x, y, 0xff9a4a, 5)
          break
        case 'fire':
          this.puff(x, y, 0xff7a2a, 4)
          break
        case 'smoke':
          this.puff(x, y, 0xffffff, 3)
          break
        case 'rubble':
          cam.shake(400, 0.004)
          this.puff(x, y, 0x9a8a78, 4)
          break
        case 'confetti':
        case 'crowd_cheer': {
          const burst = this.add.particles(x, y - T, 'fx-snow', {
            frame: [0, 1, 2, 3, 4, 5, 6],
            lifespan: 1600,
            speed: { min: 40, max: 120 },
            angle: { min: 200, max: 340 },
            gravityY: 120,
            quantity: 40,
            emitting: false,
            tint: effect.id === 'confetti' ? [0xff5c5c, 0xffd25c, 0x5cd6ff, 0x9cff5c, 0xff8ae2] : [0xffe9a8, 0xfff4d6],
          })
          burst.setDepth(45)
          burst.explode(effect.id === 'confetti' ? 60 : 30)
          this.time.delayedCall(2000, () => burst.destroy())
          break
        }
        case 'crowd_flee':
          cam.shake(250, 0.002)
          break
      }
    }
  }

  private puff(x: number, y: number, tint: number, count: number): void {
    if (!this.anims.exists('fx-smoke-puff') && this.textures.exists('fx-smoke')) {
      this.anims.create({ key: 'fx-smoke-puff', frames: this.anims.generateFrameNumbers('fx-smoke', { start: 0, end: 5 }), frameRate: 10 })
    }
    for (let i = 0; i < count; i += 1) {
      const sprite = this.add.sprite(x + (jitter(i, 1, 5) - 0.5) * T * 2, y + (jitter(i, 2, 6) - 0.5) * T, 'fx-smoke', 0).setDepth(44).setTint(tint).setAlpha(0.85)
      this.time.delayedCall(i * 90, () => {
        if (this.anims.exists('fx-smoke-puff')) sprite.play('fx-smoke-puff')
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy())
        this.time.delayedCall(1200, () => sprite.destroy())
      })
    }
  }

  // ---------------------------------------------------------------------------
  // sound

  private applyAudio(snapshot: PlaygroundSnapshot): void {
    const muted = snapshot.audio?.muted ?? false
    this.sound.mute = muted
    if (this.sound.locked) return

    const ambientId = snapshot.ambient?.id ?? 'clear'
    const wantMusic = MUSIC_FOR[ambientId] ?? 'calm-village'
    if (wantMusic !== this.musicKey && this.cache.audio.exists(`music-${wantMusic}`)) {
      const previous = this.music
      if (previous) {
        this.tweens.add({ targets: previous, volume: 0, duration: 900, onComplete: () => previous.destroy() })
      }
      const next = this.sound.add(`music-${wantMusic}`, { loop: true, volume: 0 })
      next.play()
      this.tweens.add({ targets: next, volume: MUSIC_VOLUME, duration: 1200 })
      this.music = next
      this.musicKey = wantMusic
    }

    const wantLoop = AMBIENT_LOOP[ambientId] ?? null
    if (wantLoop !== this.ambientLoopKey) {
      this.ambientLoop?.destroy()
      this.ambientLoop = null
      if (wantLoop && this.cache.audio.exists(`loop-${wantLoop}`)) {
        const intensity = snapshot.ambient?.intensity ?? 1
        this.ambientLoop = this.sound.add(`loop-${wantLoop}`, { loop: true, volume: 0.12 + 0.1 * intensity })
        this.ambientLoop.play()
      }
      this.ambientLoopKey = wantLoop
    }

    for (const cue of snapshot.audio?.cues ?? []) {
      if (this.playedCues.has(cue.key)) continue
      this.playedCues.add(cue.key)
      if (this.cache.audio.exists(`sfx-${cue.id}`)) this.sound.play(`sfx-${cue.id}`, { volume: cue.id === 'step' ? 0.25 : 0.6 })
    }
  }

  private roomName(id: string): string {
    return this.current.roomNames?.[id] ?? id
  }
}

export function createTiledMapView(
  parent: HTMLElement,
  snapshot: PlaygroundSnapshot,
  onDestination: (point: Point, inputAt?: number) => void,
  reducedMotion: boolean,
  options: TiledViewOptions,
): Promise<MapView> {
  return new Promise((resolve, reject) => {
    let game: Phaser.Game | undefined
    let handle: MapView
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      game?.destroy(true)
      reject(new Error('Map renderer timed out while starting'))
    }, 15000)
    const ready = () => {
      if (settled || !handle) return
      settled = true
      window.clearTimeout(timeout)
      resolve(handle)
    }
    try {
      const scene = new TiledScene(snapshot, onDestination, reducedMotion, ready, options)
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        backgroundColor: '#4f5d3a',
        scene,
        pixelArt: true,
        scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 640, height: parent.clientHeight || 480 },
      })
      handle = {
        render(next) {
          scene.apply(next)
        },
        setReducedMotion(enabled) {
          scene.setReducedMotion(enabled)
        },
        destroy() {
          scene.tweens.killAll()
          game?.destroy(true)
        },
      }
    } catch (error) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      game?.destroy(true)
      reject(error)
    }
  })
}

export type { StageMap }
