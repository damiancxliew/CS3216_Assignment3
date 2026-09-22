import Phaser from 'phaser'
import { findPath, isWalkable, type Point } from '@adventure/game-core'
import { roomNames } from './fixture.js'
import { tileFromPointer } from './pointer.js'
import type { PlaygroundSnapshot } from './model.js'

const TILE_SIZE = 24
const COLORS = {
  grass: 0x9aa274,
  path: 0xc8ad78,
  wall: 0x292820,
  floor: 0xe4d2a9,
  door: 0xc8ad78,
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
    const graphics = this.add.graphics()
    graphics.lineStyle(1, 0x292820, 0.26)
    for (let y = 0; y < this.current.map.height; y += 1) {
      for (let x = 0; x < this.current.map.width; x += 1) {
        const tile = this.current.map.tiles[y]![x]!
        graphics.fillStyle(COLORS[tile], tile === 'wall' ? 1 : 0.95)
        graphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        if (tile !== 'wall') graphics.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      }
    }
    for (const room of this.current.map.rooms) {
      graphics.lineStyle(2, 0x292820, 0.8)
      graphics.strokeRect(room.x * TILE_SIZE, room.y * TILE_SIZE, room.width * TILE_SIZE, room.height * TILE_SIZE)
      const label = this.add.text((room.x + room.width / 2) * TILE_SIZE, (room.y + room.height / 2) * TILE_SIZE, this.roomName(room.id), {
        color: '#292820',
        fontFamily: 'Georgia, serif',
        fontSize: '16px',
        backgroundColor: '#ead9b5',
        padding: { x: 5, y: 3 },
      }).setOrigin(0.5)
      this.labels.set(room.id, label)
    }
    this.staticGraphics = graphics
    this.doorGraphics = this.add.graphics()
    this.routeGraphics = this.add.graphics()
  }

  private renderSnapshot(snapshot: PlaygroundSnapshot, snap = false): void {
    if (!this.routeGraphics || !this.doorGraphics) return
    this.doorGraphics.clear()
    for (const door of snapshot.map.doors) {
      const x = door.position.x * TILE_SIZE
      const y = door.position.y * TILE_SIZE
      this.doorGraphics.fillStyle(0xc8ad78, 1)
      this.doorGraphics.fillRect(x, y, TILE_SIZE, TILE_SIZE)
      if (snapshot.doors[door.id] === 'open') {
        this.doorGraphics.fillStyle(0x292820, 1)
        this.doorGraphics.fillRect(x + 2, y + 3, 3, TILE_SIZE - 6)
        this.doorGraphics.fillRect(x + TILE_SIZE - 5, y + 3, 3, TILE_SIZE - 6)
      } else {
        this.doorGraphics.fillStyle(0xa14f3c, 1)
        this.doorGraphics.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6)
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
        this.routeGraphics.lineStyle(2, 0x315c5f, 0.55)
        for (const point of path) {
          this.routeGraphics.strokeCircle(point.x * TILE_SIZE + TILE_SIZE / 2, point.y * TILE_SIZE + TILE_SIZE / 2, 4)
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
      const radius = offset === 0 ? 0 : 6
      const x = actor.position.x * TILE_SIZE + TILE_SIZE / 2 + Math.round(Math.cos(angle) * radius)
      const y = actor.position.y * TILE_SIZE + TILE_SIZE / 2 + Math.round(Math.sin(angle) * radius)
      this.markers.set(actor.id, marker)
      if (isNew || this.reducedMotion || snap) {
        this.tweens.killTweensOf(marker)
        marker.setPosition(x, y)
      } else if (marker.x !== x || marker.y !== y) {
        this.tweens.killTweensOf(marker)
        this.tweens.add({ targets: marker, x, y, duration: 100, ease: 'Sine.easeOut' })
      }
    }
  }

  private createMarker(player: boolean, name: string): Phaser.GameObjects.Container {
    const marker = this.add.container(0, 0)
    const circle = this.add.graphics()
    circle.fillStyle(player ? 0x315c5f : 0xa14f3c, 1)
    circle.fillCircle(0, 0, 8)
    circle.lineStyle(2, player ? 0xffffff : 0xc8ad78, 1)
    circle.strokeCircle(0, 0, 8)
    const label = this.add.text(0, 12, name, { color: '#292820', fontFamily: 'system-ui, sans-serif', fontSize: '12px' }).setOrigin(0.5, 0)
    marker.add([circle, label])
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
        backgroundColor: '#ead9b5',
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
