import Phaser from 'phaser'
import { findPath, isWalkable, type Point, type StageMap } from '@adventure/game-core'
import type { PlaygroundSnapshot } from './model.js'
import type { StoryArt } from './story-art.js'
import { makeFaunaSheet, storyFauna } from './fauna.js'
import { isExposed } from './weather.js'

export const RESIDENT_SPRITES = ['Villager', 'Villager2', 'Woman', 'OldMan', 'Monk2']
type Resident = { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; sheet: string; stepMs: number; at: Point; path: Point[]; progress: number; pause: number; stop: number }

/** Cosmetic passers-by never join conversations or alter authoritative actor positions. */
export class AmbientLife {
  private residents: Resident[] = []
  private stops: Point[] = []
  private routes: StageMap
  constructor(scene: Phaser.Scene, snapshot: PlaygroundSnapshot, art: StoryArt) {
    const map = snapshot.map
    // Reuse core pathfinding on a public outdoor-only projection: no shortcuts through rooms.
    this.routes = { ...map, tiles: map.tiles.map((row, y) => row.map((tile, x) => isExposed(map, x, y) && tile !== 'door' ? tile : 'wall')) }
    const allowed = (p: Point) => isWalkable(this.routes, {}, p)
    const candidates = [...map.doors.map(d => d.outside), ...(map.scenery ?? []).flatMap(p => [{ x: p.x + 1, y: p.y }, { x: p.x, y: p.y + 1 }])]
    this.stops = candidates.filter(p => allowed(p))
    if (this.stops.length < 3) for (let y = 3; y < map.height - 3; y += 4) for (let x = 3; x < map.width - 3; x += 5) if (map.tiles[y]?.[x] === 'path' && allowed({ x, y })) this.stops.push({ x, y })
    if (this.stops.length < 2) return
    const population = snapshot.environment?.population ?? (['ruins', 'jungle', 'battlefield'].includes(art.id) ? 'quiet' : 'residents')
    const sheets = art.id === 'desert' || art.id === 'palace' ? ['Monk2', 'Villager2', 'OldMan'] : population === 'workers' ? ['Villager', 'Villager2', 'OldMan'] : ['Woman', 'Villager2', 'OldMan', 'Villager']
    const count = population === 'quiet' ? 0 : population === 'residents' ? 4 : 6
    for (let i = 0; i < count; i++) {
      const stop = Math.floor(i * this.stops.length / count), at = this.stops[stop]!, sheet = sheets[i % sheets.length]!
      const shadow = scene.add.ellipse(at.x * 16 + 8, at.y * 16 + 13, 10, 4, 0x243d35, .22).setDepth(8)
      const sprite = scene.add.sprite(at.x * 16 + 8, at.y * 16 + 6, `char-${sheet}`, 0).setDepth(12).setName(`ambient-${population}-${i}`)
      this.residents.push({ sprite, shadow, sheet: `char-${sheet}`, stepMs: 430, at, path: [], progress: 0, pause: i * 450, stop })
    }
    for (const [index, species] of storyFauna(snapshot.environment, art, snapshot.storyContext ?? '').entries()) {
      const sheet = makeFaunaSheet(scene, species)
      const number = species === 'camel' || species === 'chicken' ? 2 : 1
      for (let i = 0; i < number; i++) {
        const stop = (index * 7 + i * 2 + 1) % this.stops.length, at = this.stops[stop]!
        const shadow = scene.add.ellipse(at.x * 16 + 8, at.y * 16 + 13, species === 'camel' ? 13 : 9, 5, 0x243d35, .2).setDepth(8)
        const sprite = scene.add.sprite(at.x * 16 + 8, at.y * 16 + 6, sheet, 0).setDepth(12).setName(`ambient-animal-${species}-${i}`)
        this.residents.push({ sprite, shadow, sheet, stepMs: species === 'camel' ? 620 : 510, at, path: [], progress: 0, pause: i * 1200, stop })
      }
    }
  }
  update(delta: number, reduced: boolean, running: boolean): void {
    const dt = Math.min(delta, 80)
    for (const person of this.residents) {
      if (reduced || !running || document.hidden) { person.sprite.anims.pause(); continue }
      person.sprite.anims.resume()
      if (person.pause > 0) { person.pause -= dt; continue }
      if (!person.path.length) {
        person.stop = (person.stop + 3) % this.stops.length
        person.path = findPath(this.routes, {}, person.at, this.stops[person.stop]!) ?? []
        if (!person.path.length) { person.pause = 600; person.stop++; continue }
      }
      const next = person.path[0]!, dx = next.x - person.at.x, dy = next.y - person.at.y
      const facing = dx ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up'
      person.sprite.play(`${person.sheet}-${facing}`, true)
      person.progress = Math.min(1, person.progress + dt / person.stepMs)
      person.sprite.setPosition(Math.round((person.at.x + dx * person.progress) * 16 + 8), Math.round((person.at.y + dy * person.progress) * 16 + 6))
      person.shadow.setPosition(person.sprite.x, person.sprite.y + 7)
      if (person.progress >= 1) {
        person.at = next; person.path.shift(); person.progress = 0
        if (!person.path.length) { person.pause = 1500 + person.stop % 4 * 700; person.sprite.stop() }
      }
    }
  }
  destroy(): void { this.residents.forEach(p => { p.sprite.destroy(); p.shadow.destroy() }) }
}
