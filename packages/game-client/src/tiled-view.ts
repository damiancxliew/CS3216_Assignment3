/**
 * Tileset renderer: the same `MapView` contract as `view.ts`, drawn from a curated
 * 16px pack instead of primitives. Terrain, walls, doors, characters and effects
 * are hand-drawn assets (PRD D4). Generated landmarks are reduced and palette
 * matched to the same grid before becoming four physical map tiles.
 *
 * Expects, under `assetBase`:
 *   tiles/floor.png     ground autotiles (22 columns)     tiles/wall.png      room walls (10 columns)
 *   tiles/interior.png  plank floors (22 columns)         tiles/house.png     door frames (33 columns)
 *   characters/<Sprite>/walk.png   4 columns = down/up/left/right, 4 rows = frames
 *   fx/rain.png fx/snow.png (8px frames), fx/fog.png, fx/clouds.png, fx/smoke.png (32px frames)
 * Optional theme terrain sheets live under `themeBase/<theme>/terrain.png`.
 */
import Phaser from 'phaser'
import { LANDMARK_KINDS, spaceAt, type Point, type StageMap } from '@adventure/game-core'
import { tileFromPointer } from './pointer.js'
import { selectHitTargetId } from './prop-hint.js'
import { layoutMapLabels, overlaps, type LabelRect } from './map-labels.js'
import { fixtureScenery, roomScenery, usesUrbanGround } from './scenery.js'
import { matchMapPalette } from './pixel-art.js'
import type { MapThemeId, PlaygroundSnapshot, SoundCueId } from './model.js'
import { MUSIC_TRACKS, selectMusicTrack } from './music.js'
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

type TerrainTheme = { ground: readonly number[]; path: readonly number[]; classicPath?: boolean; pathTint?: number; floorTint: number; wallTint: number; doorTint: number; background: string }
const TERRAIN: Partial<Record<MapThemeId, TerrainTheme>> = {
  desert: { ground: [7], path: [], classicPath: true, pathTint: 0xe3c17f, floorTint: 0xd8b679, wallTint: 0xc49b63, doorTint: 0xcaa36e, background: '#dbca7c' },
  winter: { ground: [145, 145, 144], path: [], classicPath: true, pathTint: 0xc9d8e4, floorTint: 0xcad9e4, wallTint: 0xaabed5, doorTint: 0xb9cee0, background: '#d7ecf4' },
  forest: { ground: [0, 1, 2, 27, 28], path: [32, 32, 31], floorTint: 0xb99972, wallTint: 0x9b7961, doorTint: 0xa6886b, background: '#5c9f56' },
  coast: { ground: [7, 7, 7], path: [25, 25, 25], floorTint: 0xd3b484, wallTint: 0xb7a288, doorTint: 0xc9aa7e, background: '#81b075' },
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

function assetTextureKey(url: string): string {
  let hash = 2166136261
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `asset-${(hash >>> 0).toString(16)}`
}

export interface TiledViewOptions {
  assetBase: string
  /** Directory containing <theme>/terrain.png for curated map themes. */
  themeBase?: string
  /** Sprite key to use for an actor that does not name one. */
  defaultSprite?: string
  /** Called when the player clicks a character instead of a tile. */
  onActor?: (actorId: string) => void
  /** Called when the player clicks a document or object lying on the map. */
  onProp?: (propId: string) => void
  /** Called when the player clicks an in-world landmark. */
  onLandmark?: (landmarkId: string) => void
}

class TiledScene extends Phaser.Scene {
  private current: PlaygroundSnapshot
  private readonly onDestination: (point: Point, inputAt?: number) => void
  private readonly onReady: () => void
  private readonly base: string
  private readonly themeBase: string
  private readonly defaultSprite: string
  private readonly onActor: ((actorId: string) => void) | undefined
  private readonly onProp: ((propId: string) => void) | undefined
  private readonly onLandmark: ((landmarkId: string) => void) | undefined
  private reducedMotion: boolean
  private ready = false
  private map?: Phaser.Tilemaps.Tilemap
  private ground?: Phaser.Tilemaps.TilemapLayer
  private pathLayer: Phaser.Tilemaps.TilemapLayer | undefined
  private floors?: Phaser.Tilemaps.TilemapLayer
  private walls?: Phaser.Tilemaps.TilemapLayer
  private landmarkLayer?: Phaser.Tilemaps.TilemapLayer
  private generatedLandmarkLayers = new Map<string, Phaser.Tilemaps.TilemapLayer>()
  private landmarkTileSignature = ''
  private previousLandmarkPositions: Point[] = []
  private doors = new Map<string, Phaser.GameObjects.Image>()
  private labels: Phaser.GameObjects.Text[] = []
  private captions = new Map<string, Phaser.GameObjects.Text>()
  private captionLines?: Phaser.GameObjects.Graphics
  private hoveredTarget: string | null = null
  private markers = new Map<
    string,
    {
      container: Phaser.GameObjects.Container
      sprite: Phaser.GameObjects.Sprite
      key: string
      facing: Facing
      last: Point
      /** Pending "stop walking": re-armed by each step, so a continuous walk keeps its animation. */
      idle: Phaser.Time.TimerEvent | null
    }
  >()
  private props = new Map<string, { container: Phaser.GameObjects.Container; found: boolean; imageUrl: string | null }>()
  private loadedSprites = new Set<string>()
  private queuedAssets = new Set<string>()
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
    this.themeBase = (options.themeBase ?? `${this.base}/themes`).replace(/\/$/, '')
    this.defaultSprite = options.defaultSprite ?? 'Villager'
    this.onActor = options.onActor
    this.onProp = options.onProp
    this.onLandmark = options.onLandmark
  }

  preload(): void {
    this.load.image('tiles-floor', `${this.base}/tiles/floor.png`)
    this.load.image('tiles-wall', `${this.base}/tiles/wall.png`)
    this.load.image('tiles-interior', `${this.base}/tiles/interior.png`)
    this.load.image('landmark-tiles', `${this.base}/tiles/landmarks.svg`)
    this.load.image('period-interiors', `${this.base}/tiles/period-interiors.svg`)
    this.load.image('period-fixtures', `${this.base}/tiles/period-fixtures.svg`)
    const theme = this.current.mapTheme ?? 'classic'
    if (TERRAIN[theme]) this.load.image('theme-terrain', `${this.themeBase}/${theme}/terrain.png`)
    this.load.spritesheet('house', `${this.base}/tiles/house.png`, { frameWidth: T, frameHeight: T })
    this.load.spritesheet('fx-rain', `${this.base}/fx/rain.png`, { frameWidth: 8, frameHeight: 8 })
    this.load.spritesheet('fx-snow', `${this.base}/fx/snow.png`, { frameWidth: 8, frameHeight: 8 })
    this.load.spritesheet('fx-smoke', `${this.base}/fx/smoke.png`, { frameWidth: 32, frameHeight: 32 })
    this.load.image('fx-fog', `${this.base}/fx/fog.png`)
    this.load.image('fx-clouds', `${this.base}/fx/clouds.png`)
    for (const key of this.spriteKeys(this.current)) this.queueSprite(key)
    for (const url of this.spriteSheetUrls(this.current)) this.queueGeneratedSprite(url)
    for (const url of this.assetUrls(this.current)) this.queueAsset(url)
    for (const track of MUSIC_TRACKS) this.load.audio(`music-${track}`, `${this.base}/audio/music/${track}.ogg`)
    for (const loop of new Set(Object.values(AMBIENT_LOOP))) if (loop) this.load.audio(`loop-${loop}`, `${this.base}/audio/sfx/${loop}.ogg`)
    for (const cue of SFX) this.load.audio(`sfx-${cue}`, `${this.base}/audio/sfx/${cue}.ogg`)
  }

  create(): void {
    this.ready = true
    for (const key of this.spriteKeys(this.current)) this.registerAnimations(key)
    for (const url of this.spriteSheetUrls(this.current)) this.registerAnimations(assetTextureKey(url), true)
    this.buildMap()
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.hoveredTarget = this.hitTarget({ x: pointer.worldX, y: pointer.worldY })
      this.game.canvas.style.cursor = this.hoveredTarget ? 'pointer' : 'default'
    })
    this.input.on('gameout', () => { this.hoveredTarget = null })
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const target = this.hitTarget({ x: pointer.worldX, y: pointer.worldY })
      if (target && this.activateTarget(target)) {
        this.game.canvas.focus()
        return
      }
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
      const landmark = (this.current.landmarks ?? []).find((item) =>
        point.x >= item.position.x && point.x < item.position.x + item.width && point.y >= item.position.y && point.y < item.position.y + item.height)
      if (landmark && this.onLandmark) {
        this.onLandmark(landmark.id)
        this.game.canvas.focus()
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
    const missingSprites = this.spriteKeys(snapshot).filter((key) => !this.loadedSprites.has(key))
    const missingGenerated = this.spriteSheetUrls(snapshot).filter((url) => !this.queuedAssets.has(url))
    const missingAssets = this.assetUrls(snapshot).filter((url) => !this.queuedAssets.has(url))
    if (missingSprites.length > 0 || missingGenerated.length > 0 || missingAssets.length > 0) {
      for (const key of missingSprites) this.queueSprite(key)
      for (const url of missingGenerated) this.queueGeneratedSprite(url)
      for (const url of missingAssets) this.queueAsset(url)
      this.load.once('complete', () => {
        for (const key of missingSprites) this.registerAnimations(key)
        for (const url of missingGenerated) this.registerAnimations(assetTextureKey(url), true)
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

  private assetUrls(snapshot: PlaygroundSnapshot): string[] {
    return [...new Set([
      ...(snapshot.props ?? []).flatMap((prop) => prop.imageUrl ? [prop.imageUrl] : []),
      ...(snapshot.landmarks ?? []).flatMap((landmark) => landmark.imageUrl ? [landmark.imageUrl] : []),
    ])]
  }

  private spriteSheetUrls(snapshot: PlaygroundSnapshot): string[] {
    return [...new Set(snapshot.actors.flatMap((actor) => actor.spriteSheetUrl ? [actor.spriteSheetUrl] : []))]
  }

  private queueSprite(key: string): void {
    if (this.loadedSprites.has(key)) return
    this.loadedSprites.add(key)
    this.load.spritesheet(`char-${key}`, `${this.base}/characters/${key}/walk.png`, { frameWidth: T, frameHeight: T })
  }

  private queueGeneratedSprite(url: string): void {
    if (this.queuedAssets.has(url)) return
    this.queuedAssets.add(url)
    this.load.spritesheet(assetTextureKey(url), url, { frameWidth: T, frameHeight: T })
  }

  private queueAsset(url: string): void {
    if (this.queuedAssets.has(url)) return
    this.queuedAssets.add(url)
    this.load.image(assetTextureKey(url), url)
  }

  private registerAnimations(key: string, generated = false): void {
    const textureKey = generated ? key : `char-${key}`
    if (!this.textures.exists(textureKey)) return
    DIRECTIONS.forEach((facing, column) => {
      const anim = `${textureKey}-${facing}`
      if (this.anims.exists(anim)) return
      this.anims.create({
        key: anim,
        frames: [0, 1, 2, 3].map((row) => ({ key: textureKey, frame: row * 4 + column })),
        frameRate: 8,
        repeat: -1,
      })
    })
  }

  private buildMap(): void {
    this.generatedLandmarkLayers.forEach((layer) => layer.destroy())
    this.generatedLandmarkLayers.clear()
    this.map?.destroy()
    this.captions.forEach((caption) => caption.destroy())
    this.captions.clear()
    this.captionLines?.destroy()
    this.captionLines = this.add.graphics().setDepth(59)
    this.hoveredTarget = null
    this.landmarkTileSignature = ''
    this.previousLandmarkPositions = []
    this.doors.forEach((d) => d.destroy())
    this.doors.clear()
    this.labels.forEach((l) => l.destroy())
    this.labels = []
    this.markers.forEach((m) => { m.idle?.remove(); m.container.destroy() })
    this.markers.clear()
    this.props.forEach((p) => p.container.destroy())
    this.props.clear()
    this.clearAmbient()

    const source = this.current.map
    const urban = usesUrbanGround(source.rooms.map((room) => this.roomDescription(room.id)))
    const map = this.make.tilemap({ tileWidth: T, tileHeight: T, width: source.width, height: source.height })
    const terrain = TERRAIN[this.current.mapTheme ?? 'classic']
    const floorSet = map.addTilesetImage(terrain ? 'theme-terrain' : 'tiles-floor', terrain ? 'theme-terrain' : 'tiles-floor', T, T, 0, 0)!
    const pathSet = terrain?.classicPath ? map.addTilesetImage('tiles-floor', 'tiles-floor', T, T, 0, 0)! : null
    const wallSet = map.addTilesetImage('tiles-wall', 'tiles-wall', T, T, 0, 0)!
    const interiorSet = map.addTilesetImage('tiles-interior', 'tiles-interior', T, T, 0, 0)!
    const landmarkSet = map.addTilesetImage('landmark-tiles', 'landmark-tiles', T, T, 0, 0)!
    const periodSet = map.addTilesetImage('period-interiors', 'period-interiors', T, T, 0, 0, 1000)!
    const fixtureSet = map.addTilesetImage('period-fixtures', 'period-fixtures', T, T, 0, 0, 2000)!
    this.ground = map.createBlankLayer('ground', [floorSet, periodSet])!.setDepth(0)
    this.pathLayer = pathSet ? map.createBlankLayer('paths', pathSet)!.setDepth(0.5).setTint(terrain?.pathTint ?? 0xffffff) : undefined
    this.floors = map.createBlankLayer('floors', [interiorSet, periodSet])!.setDepth(1)
    this.walls = map.createBlankLayer('walls', wallSet)!.setDepth(2)
    this.landmarkLayer = map.createBlankLayer('landmark-fixtures', [landmarkSet, fixtureSet])!.setDepth(4)
    if (terrain) {
      this.cameras.main.setBackgroundColor(terrain.background)
      this.floors.setTint(terrain.floorTint)
      this.walls.setTint(terrain.wallTint)
    }
    if (urban) {
      this.walls.setTint(0xb5bcb1)
      this.floors.setTint(0xffffff)
      this.cameras.main.setBackgroundColor('#414945')
    }
    this.map = map

    const isPath = (x: number, y: number) => source.tiles[y]?.[x] === 'path'
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const tile = source.tiles[y]![x]!
        // Public place descriptions select paving for a newsroom; outdoor settings keep their terrain.
        const groundTiles = terrain?.ground ?? GRASS
        this.ground.putTileAt(urban ? 1000 : groundTiles[Math.floor(jitter(x, y, 1) * groundTiles.length)]!, x, y)
        if (tile === 'path') {
          const mask = (isPath(x, y - 1) ? 1 : 0) | (isPath(x + 1, y) ? 2 : 0) | (isPath(x, y + 1) ? 4 : 0) | (isPath(x - 1, y) ? 8 : 0)
          const pathTiles = terrain?.path
          if (urban) this.ground.putTileAt(1001, x, y)
          else if (this.pathLayer) this.pathLayer.putTileAt(PATH[mask] ?? PATH[15]!, x, y)
          else this.ground.putTileAt(pathTiles ? pathTiles[Math.floor(jitter(x, y, 3) * pathTiles.length)]! : PATH[mask] ?? PATH[15]!, x, y)
        }
      }
    }
    for (const room of source.rooms) {
      const style = roomScenery(this.roomDescription(room.id))
      const periodFloor = { newsroom: 1002, archive: 1003, council: 1004, workshop: 1005, plain: urban ? 1003 : null }[style]
      if (room.enclosure === 'enclosed') {
        const x1 = room.x + room.width - 1
        const y1 = room.y + room.height - 1
        for (let y = room.y; y <= y1; y += 1) {
          for (let x = room.x; x <= x1; x += 1) {
            const edgeX = x === room.x ? 'l' : x === x1 ? 'r' : null
            const edgeY = y === room.y ? 't' : y === y1 ? 'b' : null
            if (!edgeX && !edgeY) {
              this.floors.putTileAt(periodFloor ?? PLANKS[Math.floor(jitter(x, y, 2) * PLANKS.length)]!, x, y)
              continue
            }
            this.floors.putTileAt(periodFloor ?? PLANKS[0]!, x, y) // under the door tile
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
            fontSize: '8px',
            wordWrap: { width: room.width * T - 12, useAdvancedWrap: true },
            align: 'center',
            fontStyle: 'bold',
            backgroundColor: '#2e2620',
            padding: { x: 4, y: 2 },
            resolution: 8,
          })
          .setOrigin(0.5, doorOnTopWall ? 1 : 0)
          .setDepth(60)
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
      if (terrain) image.setTint(terrain.doorTint)
      this.doors.set(door.id, image)
    }
    this.renderLandmarkTiles(this.current)
  }

  /** Stamp each landmark as four real map tiles. Curated tiles remain the fallback while art loads. */
  private renderLandmarkTiles(snapshot: PlaygroundSnapshot): void {
    if (!this.map || !this.landmarkLayer) return
    const landmarks = snapshot.landmarks ?? []
    const signature = JSON.stringify(landmarks.map((landmark) => [
      landmark.id, landmark.kind, landmark.name, landmark.description, landmark.position.x, landmark.position.y,
      landmark.imageUrl, landmark.imageUrl ? this.textures.exists(assetTextureKey(landmark.imageUrl)) : false,
    ]))
    if (signature === this.landmarkTileSignature) return
    this.landmarkTileSignature = signature
    for (const position of this.previousLandmarkPositions) {
      for (const layer of [this.landmarkLayer, ...this.generatedLandmarkLayers.values()]) {
        layer.removeTileAt(position.x, position.y)
        layer.removeTileAt(position.x + 1, position.y)
        layer.removeTileAt(position.x, position.y + 1)
        layer.removeTileAt(position.x + 1, position.y + 1)
      }
    }
    this.previousLandmarkPositions = landmarks.map((landmark) => landmark.position)

    for (const landmark of landmarks) {
      const url = landmark.imageUrl
      const sourceKey = url ? assetTextureKey(url) : null
      const hasGenerated = sourceKey !== null && this.textures.exists(sourceKey)
      if (hasGenerated && sourceKey) {
        // Older generated images may be 1024px. Sampling them onto a 32px canvas
        // makes the footprint exactly two map tiles wide without scaling an overlay.
        const theme = snapshot.mapTheme ?? 'classic'
        const tileKey = `${sourceKey}-${theme}-tiles`
        if (!this.textures.exists(tileKey)) {
          const texture = this.textures.createCanvas(tileKey, 32, 32)
          if (texture) {
            try {
              const context = texture.getContext()
              // Average the model's large source into the native 32px footprint,
              // then snap every pixel to an opaque map color below.
              context.imageSmoothingEnabled = true
              context.imageSmoothingQuality = 'high'
              context.clearRect(0, 0, 32, 32)
              context.drawImage(this.textures.get(sourceKey).getSourceImage() as CanvasImageSource, 0, 0, 32, 32)
              const pixels = context.getImageData(0, 0, 32, 32)
              matchMapPalette(pixels.data, theme)
              context.putImageData(pixels, 0, 0)
              texture.refresh()
            } catch {
              // Cross-origin art without pixel access still leaves the curated fixture playable.
              this.textures.remove(tileKey)
            }
          }
        }
        if (this.textures.exists(tileKey)) {
          let layer = this.generatedLandmarkLayers.get(tileKey)
          if (!layer) {
            const tileset = this.map.addTilesetImage(tileKey, tileKey, T, T, 0, 0)
            if (tileset) {
              layer = this.map.createBlankLayer(`landmark-${tileKey}`, tileset)?.setDepth(4)
              if (layer) this.generatedLandmarkLayers.set(tileKey, layer)
            }
          }
          if (layer) {
            layer.putTileAt(0, landmark.position.x, landmark.position.y)
            layer.putTileAt(1, landmark.position.x + 1, landmark.position.y)
            layer.putTileAt(2, landmark.position.x, landmark.position.y + 1)
            layer.putTileAt(3, landmark.position.x + 1, landmark.position.y + 1)
            continue
          }
        }
      }
      const period = fixtureScenery(`${landmark.name} ${landmark.description ?? ''}`)
      const index = LANDMARK_KINDS.indexOf(landmark.kind)
      if (index < 0) continue
      const column = period ? 2000 + ['radio', 'filing', 'press', 'desk'].indexOf(period) * 2 : index * 2
      const stride = period ? 8 : 16
      const x = landmark.position.x
      const y = landmark.position.y
      this.landmarkLayer.putTileAt(column, x, y)
      this.landmarkLayer.putTileAt(column + 1, x + 1, y)
      this.landmarkLayer.putTileAt(column + stride, x, y + 1)
      this.landmarkLayer.putTileAt(column + stride + 1, x + 1, y + 1)
    }
  }

  private renderSnapshot(snapshot: PlaygroundSnapshot, snap = false): void {
    this.renderLandmarkTiles(snapshot)
    for (const door of snapshot.map.doors) this.doors.get(door.id)?.setFrame(snapshot.doors[door.id] === 'open' ? DOOR.open : DOOR.closed)

    this.renderProps(snapshot)
    const occupied = new Map<string, number>()
    for (const actor of snapshot.actors) {
      const fallbackKey = `char-${actor.sprite ?? this.defaultSprite}`
      const generatedKey = actor.spriteSheetUrl ? assetTextureKey(actor.spriteSheetUrl) : null
      const key = generatedKey && this.textures.exists(generatedKey) ? generatedKey : fallbackKey
      const positionKey = `${actor.position.x},${actor.position.y}`
      const offset = occupied.get(positionKey) ?? 0
      occupied.set(positionKey, offset + 1)
      const x = actor.position.x * T + T / 2 + (offset === 0 ? 0 : Math.round(Math.cos(offset * (Math.PI / 3)) * 5))
      const y = actor.position.y * T + T / 2 + (offset === 0 ? 0 : Math.round(Math.sin(offset * (Math.PI / 3)) * 5))

      let marker = this.markers.get(actor.id)
      if (marker && marker.key !== key) {
        marker.idle?.remove()
        marker.container.destroy()
        marker = undefined
      }
      if (!marker) {
        marker = this.createMarker(key, actor.position)
        this.markers.set(actor.id, marker)
        marker.container.setPosition(x, y)
      }
      const dx = actor.position.x - marker.last.x
      const dy = actor.position.y - marker.last.y
      const moved = dx !== 0 || dy !== 0
      const facing: Facing = actor.facing ?? (moved ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up') : marker.facing)
      marker.facing = facing
      marker.last = { x: actor.position.x, y: actor.position.y }
      const animKey = `${key}-${facing}`
      if (moved && !this.reducedMotion && this.anims.exists(animKey)) {
        const walker = marker
        marker.sprite.play(animKey, true)
        marker.idle?.remove()
        marker.idle = this.time.delayedCall(STEP_MS + 100, () => {
          walker.idle = null
          if (!walker.sprite.active) return
          if (walker.sprite.anims.currentAnim?.key === animKey && walker.sprite.anims.isPlaying) walker.sprite.stop()
          if (this.textures.exists(key)) walker.sprite.setFrame(DIRECTIONS.indexOf(facing))
        })
      } else if (marker.idle === null && this.textures.exists(key)) {
        marker.sprite.setFrame(DIRECTIONS.indexOf(facing))
      }
      marker.container.setDepth(10 + actor.position.y / 1000 + (actor.id === 'player' ? 0.5 : 0))
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
        marker.idle?.remove()
        marker.container.destroy()
        this.markers.delete(id)
      }
    }
    this.applyAmbient(snapshot)
    this.playEffects(snapshot)
    this.applyAudio(snapshot)
    this.followPlayer()
    this.layoutCaptions()
  }

  private renderProps(snapshot: PlaygroundSnapshot): void {
    const props = snapshot.props ?? []
    for (const prop of props) {
      let entry = this.props.get(prop.id)
      const imageUrl = prop.imageUrl && this.textures.exists(assetTextureKey(prop.imageUrl)) ? prop.imageUrl : null
      if (entry && entry.imageUrl !== imageUrl) {
        entry.container.destroy()
        this.props.delete(prop.id)
        entry = undefined
      }
      if (!entry) {
        entry = this.createProp(imageUrl)
        this.props.set(prop.id, entry)
      }
      entry.container.setPosition(prop.position.x * T + T / 2, prop.position.y * T + T / 2)
      entry.container.setDepth(9 + prop.position.y / 1000)
      if (entry.found !== prop.found) {
        entry.found = prop.found
        entry.container.setAlpha(prop.found ? 0.55 : 1)
      }
    }
    for (const [id, entry] of this.props) {
      if (!props.some((p) => p.id === id)) {
        entry.container.destroy()
        this.props.delete(id)
      }
    }
  }

  private createProp(imageUrl: string | null) {
    const container = this.add.container(0, 0)
    const shadow = this.add.ellipse(0, 5, 10, 4, 0x000000, 0.25)
    const sheet = imageUrl
      ? this.add.image(0, 0, assetTextureKey(imageUrl)).setDisplaySize(14, 14)
      : this.add.rectangle(0, 0, 10, 12, 0xf6e7c1).setStrokeStyle(1, 0x6b563a)
    const lines = imageUrl ? [] : [-3, 0, 3].map((offset) => this.add.rectangle(0, offset, 6, 1, 0x8a7550))
    container.add([shadow, sheet, ...lines])
    return { container, found: false, imageUrl }
  }

  private createMarker(key: string, position: Point) {
    const container = this.add.container(0, 0)
    const shadow = this.add.ellipse(0, 8, 16, 5, 0x000000, 0.3)
    const textureKey = this.textures.exists(key) ? key : '__DEFAULT'
    const sprite = this.add.sprite(0, 0, textureKey, 0)
    container.add([shadow, sprite])
    return { container, sprite, key, facing: 'down' as Facing, last: { x: position.x, y: position.y }, idle: null as Phaser.Time.TimerEvent | null }
  }

  /** Keep captions separated throughout walking tweens, including between snapshots. */
  override update(): void {
    if (this.ready) this.layoutCaptions()
  }

  private roomDescription(id: string): string {
    const landmark = this.current.landmarks?.find((entry) => entry.roomId === id)
    return `${this.roomName(id)} ${this.current.roomDescriptions?.[id] ?? ''} ${landmark?.name ?? ''} ${landmark?.description ?? ''}`
  }

  private targets(): Array<{ id: string; name: string; action: string; priority: number; near: boolean; bounds: LabelRect }> {
    const player = this.current.actors.find((actor) => actor.id === 'player')
    const playerRoom = player?.space?.kind === 'room' ? player.space.roomId : null
    return [
      ...this.current.actors.flatMap((actor) => {
        const marker = this.markers.get(actor.id)
        if (!marker) return []
        const isPlayer = actor.id === 'player'
        return [{ id: `actor:${actor.id}`, name: actor.name, action: isPlayer ? '' : 'Talk', priority: isPlayer ? 40 : 30,
          near: !isPlayer && (actor.interactive ?? (playerRoom !== null && actor.space?.kind === 'room' && actor.space.roomId === playerRoom)),
          bounds: { x: marker.container.x - (isPlayer ? 8 : 10), y: marker.container.y - (isPlayer ? 8 : 14), width: isPlayer ? 16 : 20, height: isPlayer ? 16 : 28 } }]
      }),
      ...(this.current.props ?? []).map((prop) => {
        const room = spaceAt(this.current.map, prop.position)
        return { id: `prop:${prop.id}`, name: prop.name, action: prop.found ? 'Read again' : 'Read', priority: prop.found ? 10 : 25,
          near: !prop.found && playerRoom !== null && room?.kind === 'room' && room.roomId === playerRoom,
          bounds: { x: prop.position.x * T + 1, y: prop.position.y * T + 1, width: 14, height: 14 } }
      }),
      ...(this.current.landmarks ?? []).map((landmark) => ({ id: `landmark:${landmark.id}`, name: landmark.name, action: 'Inspect', priority: 15,
        near: playerRoom !== null && landmark.roomId === playerRoom,
        bounds: { x: landmark.position.x * T, y: landmark.position.y * T, width: 32, height: 32 } })),
    ]
  }

  private hitTarget(point: Point): string | null {
    // Visible captions have their own hit rectangles. Hidden captions never steal a click.
    const caption = selectHitTargetId([...this.captions].filter(([id, text]) => id !== 'actor:player' && text.visible).map(([id, text]) => ({
      id, bounds: text.getBounds(), position: { x: text.x + text.width / 2, y: text.y + text.height / 2 },
    })), point)
    if (caption) return caption
    return selectHitTargetId(this.targets().filter((target) => target.id !== 'actor:player').map((target) => ({
      ...target, position: { x: target.bounds.x + target.bounds.width / 2, y: target.bounds.y + target.bounds.height / 2 },
    })), point)
  }

  private activateTarget(target: string): boolean {
    const separator = target.indexOf(':')
    const kind = target.slice(0, separator)
    const id = target.slice(separator + 1)
    const callback = kind === 'actor' ? this.onActor : kind === 'prop' ? this.onProp : this.onLandmark
    if (!callback) return false
    callback(id)
    return true
  }

  private layoutCaptions(): void {
    const targets = this.targets()
    const camera = this.cameras.main
    const left = Math.max(T, camera.scrollX + (camera.width - camera.width / camera.zoom) / 2 + 3)
    const top = Math.max(T, camera.scrollY + (camera.height - camera.height / camera.zoom) / 2 + 3)
    const right = Math.min((this.current.map.width - 1) * T, camera.scrollX + (camera.width + camera.width / camera.zoom) / 2 - 3)
    const bottom = Math.min((this.current.map.height - 1) * T, camera.scrollY + (camera.height + camera.height / camera.zoom) / 2 - 3)
    const viewport = { x: left, y: top, width: right - left, height: bottom - top }
    const player = this.markers.get('player')?.container
    const distance = (target: typeof targets[number]) => player
      ? Math.hypot(target.bounds.x + target.bounds.width / 2 - player.x, target.bounds.y + target.bounds.height / 2 - player.y) : Infinity
    const focused = this.hoveredTarget ?? targets.filter((target) => target.near)
      .sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id))[0]?.id
    const candidates = targets.map((target) => {
      let text = this.captions.get(target.id)
      if (!text) {
        text = this.add.text(0, 0, '', {
          color: '#fff6df', fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '7px', fontStyle: 'bold',
          backgroundColor: '#29322f', padding: { x: 3, y: 2 }, resolution: 8,
          wordWrap: { width: 76, useAdvancedWrap: true }, align: 'center',
        }).setDepth(60)
        this.captions.set(target.id, text)
      }
      const active = target.id === focused
      const content = active && target.action ? `${target.name}\n${target.action}` : target.name
      if (text.text !== content) text.setText(content)
      const color = active ? '#241f18' : '#fff6df'
      const background = active ? '#f2d49b' : target.id === 'actor:player' ? '#315f62' : '#29322f'
      if (text.style.color !== color) text.setColor(color)
      if (text.style.backgroundColor !== background) text.setBackgroundColor(background)
      return { id: target.id, anchor: target.bounds, width: text.width, height: text.height, priority: active ? 100 : target.priority }
    })
    const roomBounds = this.labels.map((label) => label.getBounds())
    const doorBounds = this.current.map.doors.map((door) => ({ x: door.position.x * T, y: door.position.y * T, width: T, height: T }))
    const placed = layoutMapLabels(candidates.filter((candidate) => overlaps(candidate.anchor, viewport, 0)), viewport,
      [...roomBounds, ...doorBounds, ...targets.map((target) => target.bounds)])
    this.captionLines?.clear().lineStyle(0.5, 0xe1d1af, 0.7)
    for (const target of targets) {
      const text = this.captions.get(target.id)!
      const rect = placed.get(target.id)
      text.setVisible(Boolean(rect))
      if (!rect) continue
      text.setPosition(rect.x, rect.y)
      const x = target.bounds.x + target.bounds.width / 2
      const y = target.bounds.y + target.bounds.height / 2
      const endX = Math.max(rect.x, Math.min(x, rect.x + rect.width))
      const endY = Math.max(rect.y, Math.min(y, rect.y + rect.height))
      // Draw only the outside part of the connector so it never cuts through a face or object.
      const dx = endX - x
      const dy = endY - y
      const ratio = Math.min(dx ? target.bounds.width / 2 / Math.abs(dx) : Infinity, dy ? target.bounds.height / 2 / Math.abs(dy) : Infinity, 1)
      this.captionLines?.lineBetween(x + dx * ratio, y + dy * ratio, endX, endY)
    }
    for (const [id, text] of this.captions) {
      if (targets.some((target) => target.id === id)) continue
      text.destroy()
      this.captions.delete(id)
    }
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
    const wantMusic = selectMusicTrack(ambientId, snapshot.seed || snapshot.map.id)
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
