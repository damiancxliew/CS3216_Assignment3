import Phaser from 'phaser'
import { roomContains, type StageMap } from '@adventure/game-core'
import type { AmbientOverlayId } from './model.js'
import { surfaceNoise } from './materials.js'

const TILE = 16
export function isExposed(map: StageMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height || map.tiles[y]?.[x] === 'wall') return false
  return !map.rooms.some((room) => room.enclosure === 'enclosed' && roomContains(room, { x, y }))
}

/** Three reusable graphics buffers; particles never create per-frame game objects or timers. */
export class WeatherSurface {
  private readonly maskShape: Phaser.GameObjects.Graphics
  private readonly mask: Phaser.Display.Masks.GeometryMask
  private readonly wet: Phaser.GameObjects.Graphics
  private readonly air: Phaser.GameObjects.Graphics
  private readonly light: Phaser.GameObjects.Graphics
  private elapsed = 0
  private lastFrame = -1
  private readonly exposed: Array<{ x: number; y: number }> = []

  constructor(scene: Phaser.Scene, private readonly map: StageMap, private readonly id: AmbientOverlayId, private readonly intensity: number, private readonly reducedMotion: boolean) {
    this.maskShape = scene.make.graphics({ x: 0, y: 0 }).fillStyle(0xffffff)
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (!isExposed(map, x, y)) continue
      this.maskShape.fillRect(x * TILE, y * TILE, TILE, TILE)
      this.exposed.push({ x: x * TILE, y: y * TILE })
    }
    this.mask = this.maskShape.createGeometryMask()
    this.wet = scene.add.graphics().setDepth(1.5).setMask(this.mask).setName('weather-surface')
    this.air = scene.add.graphics().setDepth(42).setMask(this.mask).setName('weather-air')
    this.light = scene.add.graphics().setDepth(43).setMask(this.mask).setName('weather-light')
    const rain = id === 'rain' || id === 'thunderstorm'
    this.light.fillStyle(rain ? 0x223847 : id === 'fog' ? 0xb1c3bf : 0xb4a47a, rain ? id === 'thunderstorm' ? 0.19 : 0.09 : 0.07 + intensity * 0.025)
      .fillRect(0, 0, map.width * TILE, map.height * TILE)
    if (rain) {
      for (const { x, y } of this.exposed) {
        if (surfaceNoise(x, y, 61) > 0.17) continue
        const w = 5 + Math.floor(surfaceNoise(x, y, 62) * 7)
        this.wet.fillStyle(0x4c6b71, 0.32).fillRect(x + 2, y + 9, w, 3).fillRect(x + 4, y + 8, w - 3, 5)
        this.wet.fillStyle(0xc0d2c8, 0.28).fillRect(x + 3, y + 9, w - 3, 1)
      }
    }
    this.update(0)
  }

  update(delta: number): void {
    this.elapsed += Math.min(delta, 80)
    const frame = Math.floor(this.elapsed / 40)
    if (frame === this.lastFrame || (this.reducedMotion && this.lastFrame >= 0)) return
    this.lastFrame = frame
    this.air.clear()
    const width = this.map.width * TILE
    const height = this.map.height * TILE
    const seconds = this.elapsed / 1000
    if (this.id === 'rain' || this.id === 'thunderstorm') {
      if (this.reducedMotion) return // Static wet ground and overcast lighting remain.
      const storm = this.id === 'thunderstorm'
      const count = Math.min(420, Math.floor(width * height / 1100) * (this.intensity + (storm ? 2 : 0)))
      for (let i = 0; i < count; i++) {
        const speed = (storm ? 260 : 150) + surfaceNoise(i, 1) * 90
        const y = Math.floor((surfaceNoise(i, 2) * height + seconds * speed) % height)
        const x = Math.floor((surfaceNoise(i, 3) * width + seconds * (storm ? 65 : 22)) % width)
        const length = storm ? 7 : 4
        this.air.fillStyle(i % 3 ? 0xc3d8da : 0xe0e8dd, 0.25 + surfaceNoise(i, 4) * 0.25)
        // Stepped diagonal streaks stay on the native pixel grid.
        this.air.fillRect(x, y, 1, length / 2 | 0).fillRect(x + 1, y + (length / 2 | 0), 1, length / 2 | 0)
      }
      const splashes = Math.min(65, Math.floor(this.exposed.length / 8))
      for (let i = 0; i < splashes; i++) {
        const cycle = seconds * 1.7 + surfaceNoise(i, 8)
        const phase = cycle % 1
        const tile = this.exposed[Math.floor(surfaceNoise(i, Math.floor(cycle), 9) * this.exposed.length)]
        if (!tile || phase > 0.5) continue
        const radius = phase < 0.2 ? 1 : 2
        this.air.fillStyle(0xc1d5cd, (0.5 - phase) * 0.65)
          .fillRect(tile.x + 7 - radius, tile.y + 11, 1, 1)
          .fillRect(tile.x + 7 + radius, tile.y + 11, 1, 1)
          .fillRect(tile.x + 7, tile.y + 10 - radius, 1, 1)
      }
      if (storm) {
        // A slow, faint illumination of outdoor surfaces, never a full-screen white flash.
        const cycle = seconds % 19
        const glow = cycle > 12 && cycle < 12.8 ? Math.sin((cycle - 12) / 0.8 * Math.PI) * 0.12 : 0
        this.light.clear().fillStyle(0x223847, 0.19).fillRect(0, 0, width, height)
        if (glow) this.light.fillStyle(0xd4dfdf, glow).fillRect(0, 0, width, height)
      }
    } else if (this.id === 'dust') {
      const gust = .55 + Math.sin(seconds * .65) * .25 + Math.sin(seconds * 1.1) * .2
      const count = this.reducedMotion ? 45 : 90 * this.intensity
      for (let i = 0; i < count; i++) {
        const speed = 35 + surfaceNoise(i, 25) * 60 + gust * 90
        const x = Math.floor((surfaceNoise(i, 26) * width + (this.reducedMotion ? 0 : seconds * speed)) % width)
        const y = Math.floor((surfaceNoise(i, 27) * height + Math.sin(seconds + i) * 3 + seconds * 8) % height)
        this.air.fillStyle(i % 3 ? 0xd9b77a : 0x93713f, .15 + gust * .18)
          .fillRect(x, y, this.intensity > 1 ? 3 + Math.floor(gust * 7) : 2, 1)
      }
      // Long translucent grain bands surge with the wind, clipped out of interiors.
      for (let i = 0; i < this.intensity * 5; i++) {
        const x = Math.floor((surfaceNoise(i, 28) * (width + 140) + seconds * 60) % (width + 140)) - 140
        const y = Math.floor(surfaceNoise(i, 29) * height)
        this.air.fillStyle(0xcaa46b, .018 + gust * .028).fillRect(x + 20, y, 100, 3).fillRect(x, y + 3, 140, 5).fillRect(x + 30, y + 8, 90, 2)
      }
    } else {
      // Broad, sparse, dithered bands read as atmospheric depth rather than opaque clouds.
      const fog = this.id === 'fog'
      for (let i = 0; i < 24; i++) {
        const bandWidth = 55 + Math.floor(surfaceNoise(i, 12) * 100)
        const x = Math.floor((surfaceNoise(i, 13) * (width + bandWidth) + (this.reducedMotion ? 0 : seconds * (fog ? 3 : 5))) % (width + bandWidth)) - bandWidth
        const y = Math.floor(surfaceNoise(i, 14) * height)
        this.air.fillStyle(fog ? 0xc2d1c8 : 0xcaba90, 0.025 + this.intensity * 0.012)
          .fillRect(x + 8, y, bandWidth - 16, 8).fillRect(x, y + 8, bandWidth, 12).fillRect(x + 12, y + 20, bandWidth - 24, 6)
      }
    }
  }

  destroy(): void {
    this.wet.destroy(); this.air.destroy(); this.light.destroy()
    this.mask.destroy(); this.maskShape.destroy()
  }
}
