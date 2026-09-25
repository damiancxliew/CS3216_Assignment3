import Phaser from 'phaser'
import { findPath, isWalkable, type Point, type StageMap } from '@adventure/game-core'
import type { PlaygroundSnapshot } from './model.js'
import type { StoryArt } from './story-art.js'
import { makeFaunaSheet, storyFauna } from './fauna.js'
import { isExposed } from './weather.js'
import { passingRemark, streetTalk, type StreetTalk } from './street-talk.js'
import { overlaps, type LabelRect } from './map-labels.js'

export const RESIDENT_SPRITES = ['Villager', 'Villager2', 'Woman', 'OldMan', 'Monk2']
/** A passer-by the player can hear or greet. Flavour only, so it carries no actor id. */
export interface StreetPerson { id: string; name: string; at: Point }
type Talker = { id: string; talk: StreetTalk; line: number; cooldown: number }
type Resident = { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; sheet: string; stepMs: number; at: Point; path: Point[]; progress: number; pause: number; stop: number; person?: Talker; bubble: Phaser.GameObjects.Text | null; bubbleFor: number }

const REMARK_RANGE = 2
const REMARK_COOLDOWN_MS = 11000
/** Above name tags and room labels (depth 60), so a line being spoken is never covered. */
const BUBBLE_DEPTH = 62
const BUBBLE_LIFT = 12

/** Cosmetic passers-by never join conversations or alter authoritative actor positions:
 * their greetings and small talk are drawn locally from the public setting and never
 * reach the transcript, evidence or a character agent.
 */
export class AmbientLife {
  private residents: Resident[] = []
  private stops: Point[] = []
  private routes: StageMap
  private readonly scene: Phaser.Scene
  private readonly art: StoryArt['id']
  private readonly onRemark: ((person: StreetPerson, line: string) => void) | undefined
  constructor(scene: Phaser.Scene, snapshot: PlaygroundSnapshot, art: StoryArt, options?: { onRemark?: (person: StreetPerson, line: string) => void }) {
    const map = snapshot.map
    this.scene = scene
    this.art = art.id
    this.onRemark = options?.onRemark
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
      const id = `street-${i}`
      const person: Talker = { id, talk: streetTalk(`${snapshot.map.id}:${id}`, art.id, snapshot.storyContext ?? ''), line: -1, cooldown: 2000 + i * 900 }
      this.residents.push({ sprite, shadow, sheet: `char-${sheet}`, stepMs: 430, at, path: [], progress: 0, pause: i * 450, stop, person, bubble: null, bubbleFor: 0 })
    }
    for (const [index, species] of storyFauna(snapshot.environment, art, snapshot.storyContext ?? '').entries()) {
      const sheet = makeFaunaSheet(scene, species)
      const number = species === 'camel' || species === 'chicken' ? 2 : 1
      for (let i = 0; i < number; i++) {
        const stop = (index * 7 + i * 2 + 1) % this.stops.length, at = this.stops[stop]!
        const shadow = scene.add.ellipse(at.x * 16 + 8, at.y * 16 + 13, species === 'camel' ? 13 : 9, 5, 0x243d35, .2).setDepth(8)
        const sprite = scene.add.sprite(at.x * 16 + 8, at.y * 16 + 6, sheet, 0).setDepth(12).setName(`ambient-animal-${species}-${i}`)
        this.residents.push({ sprite, shadow, sheet, stepMs: species === 'camel' ? 620 : 510, at, path: [], progress: 0, pause: i * 1200, stop, bubble: null, bubbleFor: 0 })
      }
    }
  }
  /** Everyone the player could greet right now, nearest first. */
  people(): StreetPerson[] {
    return this.residents.flatMap(r => r.person ? [{ id: r.person.id, name: r.person.talk.name, at: r.at }] : [])
  }

  personAt(tile: Point): StreetPerson | null {
    const found = this.residents.find(r => r.person && r.at.x === tile.x && r.at.y === tile.y)
    return found?.person ? { id: found.person.id, name: found.person.talk.name, at: found.at } : null
  }

  /** How busy the street feels around the player, for the crowd murmur. */
  crowd(player: Point, radius = 7): number {
    return this.people().filter(p => Math.abs(p.at.x - player.x) <= radius && Math.abs(p.at.y - player.y) <= radius).length
  }

  /** Where speech bubbles are on screen, so captions can keep clear of them. */
  bubbleBounds(): LabelRect[] {
    return this.residents.flatMap(r => r.bubble ? [r.bubble.getBounds()] : [])
  }

  /** Greeting a passer-by: cycles their small talk. Returns the spoken line. */
  talk(id: string): string | null {
    const resident = this.residents.find(r => r.person?.id === id)
    if (!resident?.person) return null
    const person = resident.person
    person.line = (person.line + 1) % person.talk.lines.length
    person.cooldown = REMARK_COOLDOWN_MS
    const line = person.talk.lines[person.line]!
    this.say(resident, line, 4200)
    resident.pause = Math.max(resident.pause, 2600)
    return line
  }

  private say(resident: Resident, text: string, ms: number): void {
    resident.bubble?.destroy()
    resident.bubble = this.scene.add.text(resident.sprite.x, resident.sprite.y - 12, text, {
      color: '#241f18', fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '7px',
      backgroundColor: '#f6e7c1', padding: { x: 3, y: 2 }, resolution: 8,
      wordWrap: { width: 92, useAdvancedWrap: true }, align: 'center',
    }).setOrigin(.5, 1).setDepth(BUBBLE_DEPTH)
    resident.bubbleFor = ms
    this.stackBubbles()
  }

  /** Follow each speaker, then lift any bubble that would cover an earlier one. */
  private stackBubbles(): void {
    const placed: LabelRect[] = []
    for (const person of this.residents) {
      const bubble = person.bubble
      if (!bubble) continue
      let y = person.sprite.y - BUBBLE_LIFT
      bubble.setPosition(person.sprite.x, y)
      for (let tries = 0; tries < 8; tries++) {
        const bounds = bubble.getBounds()
        const covered = placed.find(rect => overlaps(bounds, rect, 1))
        if (!covered) break
        y = covered.y - 1
        bubble.setPosition(person.sprite.x, y)
      }
      placed.push(bubble.getBounds())
    }
  }

  update(delta: number, reduced: boolean, running: boolean, player?: Point): void {
    const dt = Math.min(delta, 80)
    for (const person of this.residents) {
      if (person.bubble) {
        person.bubbleFor -= dt
        if (person.bubbleFor <= 0) { person.bubble.destroy(); person.bubble = null }
      }
      if (person.person) {
        person.person.cooldown -= dt
        // Walking past somebody in the street earns a passing word, once in a while.
        if (player && person.person.cooldown <= 0 && running
          && Math.abs(person.at.x - player.x) <= REMARK_RANGE && Math.abs(person.at.y - player.y) <= REMARK_RANGE) {
          person.person.cooldown = REMARK_COOLDOWN_MS
          const line = passingRemark(`${person.person.id}:${person.at.x},${person.at.y}`, this.art)
          this.say(person, line, 2400)
          this.onRemark?.({ id: person.person.id, name: person.person.talk.name, at: person.at }, line)
        }
      }
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
    this.stackBubbles()
  }
  destroy(): void { this.residents.forEach(p => { p.sprite.destroy(); p.shadow.destroy(); p.bubble?.destroy() }) }
}
