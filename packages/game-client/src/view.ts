import Phaser from 'phaser'
import { findPath, isWalkable, type Point } from '@adventure/game-core'
import { roomNames } from './fixture.js'
import { tileFromPointer } from './pointer.js'
import type { PlaygroundSnapshot } from './model.js'

const TILE_SIZE = 24

/**
 * Procedural tiles until the curated tileset (PRD D4) exists. Everything here is drawn from tile
 * coordinates alone, so the same map always looks the same and nothing depends on an asset file.
 */
const PALETTE = {
  grass: [0x8fa06a, 0x87985f, 0x97a872],
  grassBlade: 0x6f8350,
  path: [0xd2b887, 0xc9ad78, 0xd9c193],
  pebble: 0xb59a68,
  wallTop: 0x4a3f33,
  wallFace: 0x2e2620,
  wallEdge: 0x1c1712,
  floor: [0xe7d4a8, 0xe1cd9f, 0xebd9b0],
  plank: 0xc9b283,
  doorFrame: 0x4a3f33,
  doorOpen: 0xf1e3c3,
  doorClosed: 0x8c4a35,
  doorHandle: 0xe3c66c,
  route: 0x315c5f,
  player: 0x2f6f73,
  playerSkin: 0xe9c9a3,
  npc: 0xa14f3c,
  npcSkin: 0xd9b089,
  ink: 0x292820,
} as const

/** Small deterministic hash so texture detail is stable per tile. */
function jitter(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1274126177) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export interface MapView {
  render(snapshot: PlaygroundSnapshot): void
  setReducedMotion(enabled: boolean): void
  destroy(): void
}

class PlaygroundScene extends Phaser.Scene {
  private current: PlaygroundSnapshot
  private readonly onDestination: (point: Point) => void
  private readonly onReady: () => void
  private reducedMotion: boolean
  private ready = false
  private staticGraphics?: Phaser.GameObjects.Graphics
  private doorGraphics?: Phaser.GameObjects.Graphics
  private routeGraphics?: Phaser.GameObjects.Graphics
  private markers = new Map<string, Phaser.GameObjects.Container>()
  private labels = new Map<string, Phaser.GameObjects.Text>()

  constructor(snapshot: PlaygroundSnapshot, onDestination: (point: Point) => void, reducedMotion: boolean, onReady: () => void) {
    super({ key: 'playground-map' })
    this.current = snapshot
    this.onDestination = onDestination
    this.reducedMotion = reducedMotion
    this.onReady = onReady
  }

  create(): void {
    this.ready = true
    this.drawStatic()
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const point = tileFromPointer(pointer.worldX, pointer.worldY, TILE_SIZE, this.current.map.width, this.current.map.height)
      if (!point) return
      this.onDestination(point)
      this.game.canvas.focus()
    })
    this.game.canvas.tabIndex = 0
    this.game.canvas.setAttribute('aria-label', 'Settlement map')
    this.renderSnapshot(this.current, true)
    queueMicrotask(this.onReady)
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
    if (!this.ready) return
    this.tweens.killAll()
    this.renderSnapshot(this.current, true)
  }

  apply(snapshot: PlaygroundSnapshot): void {
    const previous = this.current
    const previousMapId = previous.map.id
    this.current = snapshot
    if (!this.ready) return
    const mapChanged = snapshot.map.id !== previousMapId
    const reset = mapChanged || snapshot.revision < previous.revision
    if (reset) this.tweens.killAll()
    if (mapChanged) this.drawStatic()
    this.renderSnapshot(snapshot, reset)
  }

  private drawStatic(): void {
    this.tweens.killAll()
    this.staticGraphics?.destroy()
    this.doorGraphics?.destroy()
    this.routeGraphics?.destroy()
    this.markers.forEach((marker) => marker.destroy())
    this.markers.clear()
    this.labels.forEach((label) => label.destroy())
    this.labels.clear()
    const g = this.add.graphics()
    const { map } = this.current
    const isWall = (x: number, y: number) => map.tiles[y]?.[x] === 'wall'

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tile = map.tiles[y]![x]!
        const px = x * TILE_SIZE
        const py = y * TILE_SIZE
        const v = jitter(x, y, 1)
        switch (tile) {
          case 'grass': {
            g.fillStyle(PALETTE.grass[Math.floor(v * 3)]!, 1)
            g.fillRect(px, py, TILE_SIZE, TILE_SIZE)
            g.fillStyle(PALETTE.grassBlade, 0.55)
            for (let i = 0; i < 3; i += 1) {
              const bx = px + 3 + jitter(x, y, 10 + i) * (TILE_SIZE - 6)
              const by = py + 4 + jitter(x, y, 20 + i) * (TILE_SIZE - 8)
              g.fillRect(bx, by, 1.5, 4)
            }
            break
          }
          case 'water': {
            g.fillStyle(0x427c84, 1).fillRect(px, py, TILE_SIZE, TILE_SIZE)
            g.lineStyle(1, 0x99bfb4, .5).lineBetween(px + 4, py + 8, px + TILE_SIZE - 4, py + 8)
            break
          }
          case 'path': {
            g.fillStyle(PALETTE.path[Math.floor(v * 3)]!, 1)
            g.fillRect(px, py, TILE_SIZE, TILE_SIZE)
            g.fillStyle(PALETTE.pebble, 0.5)
            for (let i = 0; i < 2; i += 1) {
              g.fillCircle(px + 4 + jitter(x, y, 30 + i) * (TILE_SIZE - 8), py + 4 + jitter(x, y, 40 + i) * (TILE_SIZE - 8), 1.6)
            }
            break
          }
          case 'floor':
          case 'door': {
            // Wooden planks running horizontally, offset every other row.
            g.fillStyle(PALETTE.floor[Math.floor(v * 3)]!, 1)
            g.fillRect(px, py, TILE_SIZE, TILE_SIZE)
            g.lineStyle(1, PALETTE.plank, 0.7)
            g.lineBetween(px, py + TILE_SIZE / 2, px + TILE_SIZE, py + TILE_SIZE / 2)
            const seam = px + (y % 2 === 0 ? TILE_SIZE * 0.3 : TILE_SIZE * 0.7)
            g.lineBetween(seam, py, seam, py + TILE_SIZE / 2)
            break
          }
          case 'wall': {
            // A wall reads as a solid with a lit top edge: face colour, lighter cap where open space is above.
            g.fillStyle(PALETTE.wallFace, 1)
            g.fillRect(px, py, TILE_SIZE, TILE_SIZE)
            if (!isWall(x, y - 1)) {
              g.fillStyle(PALETTE.wallTop, 1)
              g.fillRect(px, py, TILE_SIZE, 6)
            }
            if (!isWall(x, y + 1)) {
              g.fillStyle(PALETTE.wallEdge, 1)
              g.fillRect(px, py + TILE_SIZE - 3, TILE_SIZE, 3)
            }
            break
          }
        }
      }
    }
    // Soft shadow inside rooms along the north wall, so interiors read as enclosed.
    for (const room of map.rooms) {
      g.fillStyle(0x000000, 0.08)
      g.fillRect((room.x + 1) * TILE_SIZE, (room.y + 1) * TILE_SIZE, (room.width - 2) * TILE_SIZE, 5)
      // Name plate just inside the top wall, out of the way of whoever is standing in the room.
      const label = this.add
        .text((room.x + room.width / 2) * TILE_SIZE, (room.y + 1) * TILE_SIZE + 2, this.roomName(room.id), {
          color: '#f4e9d0',
          fontFamily: 'Georgia, serif',
          fontSize: '13px',
          fontStyle: 'bold',
          backgroundColor: '#2e2620',
          padding: { x: 6, y: 2 },
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.92)
      this.labels.set(room.id, label)
    }
    this.staticGraphics = g
    this.doorGraphics = this.add.graphics()
    this.routeGraphics = this.add.graphics()
  }

  private renderSnapshot(snapshot: PlaygroundSnapshot, snap = false): void {
    if (!this.routeGraphics || !this.doorGraphics) return
    this.doorGraphics.clear()
    for (const door of snapshot.map.doors) {
      const x = door.position.x * TILE_SIZE
      const y = door.position.y * TILE_SIZE
      const open = snapshot.doors[door.id] === 'open'
      // Frame on both sides, then either an open doorway (floor showing) or a shut door with a handle.
      this.doorGraphics.fillStyle(PALETTE.doorFrame, 1)
      this.doorGraphics.fillRect(x, y, 3, TILE_SIZE)
      this.doorGraphics.fillRect(x + TILE_SIZE - 3, y, 3, TILE_SIZE)
      if (open) {
        this.doorGraphics.fillStyle(PALETTE.doorOpen, 1)
        this.doorGraphics.fillRect(x + 3, y, TILE_SIZE - 6, TILE_SIZE)
        this.doorGraphics.fillStyle(PALETTE.doorClosed, 1)
        this.doorGraphics.fillRect(x + 3, y + 2, 3, TILE_SIZE - 4) // the door, swung to one side
      } else {
        this.doorGraphics.fillStyle(PALETTE.doorClosed, 1)
        this.doorGraphics.fillRect(x + 3, y + 1, TILE_SIZE - 6, TILE_SIZE - 2)
        this.doorGraphics.lineStyle(1, PALETTE.wallEdge, 0.6)
        this.doorGraphics.lineBetween(x + TILE_SIZE / 2, y + 1, x + TILE_SIZE / 2, y + TILE_SIZE - 1)
        this.doorGraphics.fillStyle(PALETTE.doorHandle, 1)
        this.doorGraphics.fillCircle(x + TILE_SIZE / 2 + 4, y + TILE_SIZE / 2, 1.8)
      }
    }
    this.routeGraphics.clear()
    const player = snapshot.actors.find(({ id }) => id === 'player')
    const goal = snapshot.playerGoal
    let target: Point | null = goal?.kind === 'point' ? goal.point : null
    if (goal?.kind === 'room') {
      const door = snapshot.map.doors.find(({ roomId }) => roomId === goal.roomId)
      if (door) target = isWalkable(snapshot.map, snapshot.doors, door.position) ? door.inside : door.outside
    }
    if (player && target) {
      const path = findPath(snapshot.map, snapshot.doors, player.position, target)
      if (path) {
        this.routeGraphics.fillStyle(PALETTE.route, 0.45)
        for (const point of path) {
          this.routeGraphics.fillCircle(point.x * TILE_SIZE + TILE_SIZE / 2, point.y * TILE_SIZE + TILE_SIZE / 2, 3)
        }
        const last = path[path.length - 1]
        if (last) {
          this.routeGraphics.lineStyle(2, PALETTE.route, 0.8)
          this.routeGraphics.strokeCircle(last.x * TILE_SIZE + TILE_SIZE / 2, last.y * TILE_SIZE + TILE_SIZE / 2, 7)
        }
      }
    }
    const occupied = new Map<string, number>()
    for (const actor of snapshot.actors) {
      const key = `${actor.position.x},${actor.position.y}`
      const offset = occupied.get(key) ?? 0
      occupied.set(key, offset + 1)
      const existing = this.markers.get(actor.id)
      const marker = existing ?? this.createMarker(actor.id === 'player', actor.name)
      const isNew = existing === undefined
      const angle = offset * (Math.PI / 3)
      const radius = offset === 0 ? 0 : 7
      const x = actor.position.x * TILE_SIZE + TILE_SIZE / 2 + Math.round(Math.cos(angle) * radius)
      const y = actor.position.y * TILE_SIZE + TILE_SIZE / 2 + Math.round(Math.sin(angle) * radius)
      this.markers.set(actor.id, marker)
      marker.setDepth(actor.id === 'player' ? 20 : 10 + actor.position.y / 1000)
      if (isNew || this.reducedMotion || snap) {
        this.tweens.killTweensOf(marker)
        marker.setPosition(x, y)
      } else if (marker.x !== x || marker.y !== y) {
        this.tweens.killTweensOf(marker)
        this.tweens.add({ targets: marker, x, y, duration: 120, ease: 'Sine.easeOut' })
      }
    }
    for (const [id, marker] of this.markers) {
      if (!snapshot.actors.some((actor) => actor.id === id)) {
        marker.destroy()
        this.markers.delete(id)
      }
    }
  }

  /** A small figure: shadow, body, head, and a name plate beneath. */
  private createMarker(player: boolean, name: string): Phaser.GameObjects.Container {
    const marker = this.add.container(0, 0)
    const figure = this.add.graphics()
    figure.fillStyle(0x000000, 0.25)
    figure.fillEllipse(0, 9, 14, 6)
    figure.fillStyle(player ? PALETTE.player : PALETTE.npc, 1)
    figure.fillRoundedRect(-6, -3, 12, 13, 4)
    figure.fillStyle(player ? PALETTE.playerSkin : PALETTE.npcSkin, 1)
    figure.fillCircle(0, -7, 5)
    figure.lineStyle(1.5, player ? 0xffffff : 0xf4e9d0, 0.9)
    figure.strokeCircle(0, -7, 5)
    const label = this.add
      .text(0, 12, name, {
        color: '#f4e9d0',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        backgroundColor: player ? '#2f6f73' : '#3a2a24',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.95)
    marker.add([figure, label])
    return marker
  }

  private roomName(id: string): string {
    return this.current.roomNames?.[id] ?? roomNames[id] ?? id
  }
}

export function createMapView(parent: HTMLElement, snapshot: PlaygroundSnapshot, onDestination: (point: Point) => void, reducedMotion: boolean): Promise<MapView> {
  return new Promise((resolve, reject) => {
    let game: Phaser.Game | undefined
    let handle: MapView
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      game?.destroy(true)
      reject(new Error('Map renderer timed out while starting'))
    }, 10000)
    const ready = () => {
      if (settled || !handle) return
      settled = true
      window.clearTimeout(timeout)
      resolve(handle)
    }
    try {
      const scene = new PlaygroundScene(snapshot, onDestination, reducedMotion, ready)
      game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent,
        width: snapshot.map.width * TILE_SIZE,
        height: snapshot.map.height * TILE_SIZE,
        backgroundColor: '#7d8c5c',
        scene,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: snapshot.map.width * TILE_SIZE, height: snapshot.map.height * TILE_SIZE },
        render: { antialias: true, pixelArt: false },
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
