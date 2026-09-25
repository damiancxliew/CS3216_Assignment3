import type Phaser from 'phaser'
import { overlaps, type LabelRect } from './map-labels.js'

export type Edge = 'left' | 'right' | 'top' | 'bottom'
export interface PointerCandidate { id: string; target: { x: number; y: number }; width: number; height: number }
export interface PlacedPointer { id: string; edge: Edge; angle: number; bounds: LabelRect; arrow: { x: number; y: number }; text: { x: number; y: number } }

const ARROW = 8
const GAP = 2
const PAD = 2

/** Where the ray from the view's centre towards `target` leaves the view, inset by `margin`.
 * Null while the target is inside the view. */
export function edgePoint(view: LabelRect, target: { x: number; y: number }, margin = 0): { x: number; y: number; angle: number; edge: Edge } | null {
  if (target.x >= view.x && target.x <= view.x + view.width && target.y >= view.y && target.y <= view.y + view.height) return null
  const cx = view.x + view.width / 2
  const cy = view.y + view.height / 2
  const dx = target.x - cx
  const dy = target.y - cy
  const sx = dx ? Math.max(0, view.width / 2 - margin) / Math.abs(dx) : Infinity
  const sy = dy ? Math.max(0, view.height / 2 - margin) / Math.abs(dy) : Infinity
  const scale = Math.min(sx, sy)
  const edge: Edge = sx <= sy ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom')
  return { x: cx + dx * scale, y: cy + dy * scale, angle: Math.atan2(dy, dx), edge }
}

/** One chip per off-screen place, pinned to the view edge in the place's direction.
 * Nearer places claim their spot first; chips slide along the edge rather than cover each other or `obstacles`. */
export function layoutRoomPointers(candidates: readonly PointerCandidate[], view: LabelRect, obstacles: readonly LabelRect[] = [], margin = 3): PlacedPointer[] {
  const cx = view.x + view.width / 2
  const cy = view.y + view.height / 2
  const placed: PlacedPointer[] = []
  const ordered = [...candidates].sort((a, b) =>
    Math.hypot(a.target.x - cx, a.target.y - cy) - Math.hypot(b.target.x - cx, b.target.y - cy) || a.id.localeCompare(b.id))
  for (const item of ordered) {
    const point = edgePoint(view, item.target, margin)
    if (!point) continue
    const side = point.edge === 'left' || point.edge === 'right'
    const width = side ? PAD + ARROW + GAP + item.width : Math.max(item.width, ARROW) + PAD * 2
    const height = side ? Math.max(item.height, ARROW) + PAD * 2 : PAD + ARROW + GAP + item.height
    if (width > view.width - margin * 2 || height > view.height - margin * 2) continue
    const x = point.edge === 'left' ? view.x + margin : point.edge === 'right' ? view.x + view.width - margin - width : point.x - width / 2
    const y = point.edge === 'top' ? view.y + margin : point.edge === 'bottom' ? view.y + view.height - margin - height : point.y - height / 2
    const clamp = (value: number, low: number, high: number) => Math.round(Math.max(low, Math.min(value, high)))
    const at = (shift: number): LabelRect => side
      ? { x: Math.round(x), y: clamp(y + shift, view.y + margin, view.y + view.height - margin - height), width, height }
      : { x: clamp(x + shift, view.x + margin, view.x + view.width - margin - width), y: Math.round(y), width, height }
    let bounds: LabelRect | undefined
    for (let step = 0; step <= 40 && !bounds; step += 1) {
      for (const shift of step === 0 ? [0] : [step * 3, -step * 3]) {
        const rect = at(shift)
        if (!placed.some((other) => overlaps(rect, other.bounds, 1)) && !obstacles.some((other) => overlaps(rect, other, 1))) { bounds = rect; break }
      }
    }
    if (!bounds) continue
    const arrow = point.edge === 'left' ? { x: bounds.x + PAD + ARROW / 2, y: bounds.y + bounds.height / 2 }
      : point.edge === 'right' ? { x: bounds.x + bounds.width - PAD - ARROW / 2, y: bounds.y + bounds.height / 2 }
        : point.edge === 'top' ? { x: bounds.x + bounds.width / 2, y: bounds.y + PAD + ARROW / 2 }
          : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - PAD - ARROW / 2 }
    const text = point.edge === 'left' ? { x: bounds.x + PAD + ARROW + GAP, y: bounds.y + (bounds.height - item.height) / 2 }
      : point.edge === 'right' ? { x: bounds.x, y: bounds.y + (bounds.height - item.height) / 2 }
        : point.edge === 'top' ? { x: bounds.x + (bounds.width - item.width) / 2, y: bounds.y + PAD + ARROW + GAP }
          : { x: bounds.x + (bounds.width - item.width) / 2, y: bounds.y }
    placed.push({ id: item.id, edge: point.edge, angle: point.angle, bounds, arrow, text })
  }
  return placed
}

/** Arrows at the screen edge naming each place whose map label has scrolled out of view,
 * so the player knows which way to walk to bring it back. */
export class RoomPointers {
  private graphics?: Phaser.GameObjects.Graphics
  private readonly texts = new Map<string, Phaser.GameObjects.Text>()

  constructor(private readonly scene: Phaser.Scene) {}

  update(camera: Phaser.Cameras.Scene2D.Camera, places: ReadonlyArray<{ id: string; name: string; bounds: LabelRect }>, obstacles: readonly LabelRect[]): void {
    const width = camera.width / camera.zoom
    const height = camera.height / camera.zoom
    const view = { x: camera.scrollX + (camera.width - width) / 2, y: camera.scrollY + (camera.height - height) / 2, width, height }
    for (const [id, text] of this.texts) {
      if (places.some((place) => place.id === id)) continue
      text.destroy()
      this.texts.delete(id)
    }
    const candidates = places.map((place) => {
      let text = this.texts.get(place.id)
      if (!text) {
        text = this.scene.add.text(0, 0, place.name, {
          color: '#fff8e7', fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '7px', fontStyle: 'bold',
          padding: { x: 2, y: 1 }, resolution: 8, wordWrap: { width: 72, useAdvancedWrap: true }, align: 'center',
        }).setDepth(62)
        this.texts.set(place.id, text)
      }
      if (text.text !== place.name) text.setText(place.name)
      return { id: place.id, target: { x: place.bounds.x + place.bounds.width / 2, y: place.bounds.y + place.bounds.height / 2 }, width: text.width, height: text.height }
    })
    const placed = layoutRoomPointers(candidates, view, obstacles)
    const graphics = this.graphics ??= this.scene.add.graphics().setDepth(61)
    graphics.clear()
    for (const [id, text] of this.texts) text.setVisible(placed.some((pointer) => pointer.id === id))
    for (const pointer of placed) {
      this.texts.get(pointer.id)!.setPosition(pointer.text.x, pointer.text.y)
      const { x, y, width: w, height: h } = pointer.bounds
      graphics.fillStyle(0x2e2620, 0.92).fillRoundedRect(x, y, w, h, 2)
      graphics.lineStyle(0.5, 0xf2d49b, 0.8).strokeRoundedRect(x, y, w, h, 2)
      const cos = Math.cos(pointer.angle)
      const sin = Math.sin(pointer.angle)
      // A shaft plus a narrow head reads as a direction even at a few pixels across.
      const { x: ax, y: ay } = pointer.arrow
      const half = ARROW / 2
      const neck = half - 3.5
      graphics.lineStyle(1.5, 0xf2d49b, 1).lineBetween(ax - cos * half, ay - sin * half, ax + cos * neck, ay + sin * neck)
      graphics.fillStyle(0xf2d49b, 1).fillTriangle(
        ax + cos * half, ay + sin * half,
        ax + cos * neck - sin * 2.6, ay + sin * neck + cos * 2.6,
        ax + cos * neck + sin * 2.6, ay + sin * neck - cos * 2.6,
      )
    }
  }
}
