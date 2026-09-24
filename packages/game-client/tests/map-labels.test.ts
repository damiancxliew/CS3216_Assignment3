import { describe, expect, it } from 'vitest'
import { layoutMapLabels, overlaps, type MapLabelCandidate } from '../src/map-labels.js'
import { selectHitTargetId } from '../src/prop-hint.js'

describe('shared map caption layout', () => {
  const bounds = { x: 16, y: 16, width: 400, height: 300 }
  const candidate = (id: string, x: number, y: number, priority = 20): MapLabelCandidate => ({
    id, anchor: { x, y, width: 16, height: 16 }, width: 78, height: 20, priority,
  })

  it('separates crowded actor, evidence and landmark names from each other and the artwork', () => {
    const candidates = [candidate('actor', 105, 100), candidate('prop', 100, 116), candidate('landmark', 96, 80), candidate('player', 108, 120)]
    const obstacles = [...candidates.map((entry) => entry.anchor), { x: 90, y: 55, width: 100, height: 16 }]
    const labels = [...layoutMapLabels(candidates, bounds, obstacles).values()]
    expect(labels).toHaveLength(4)
    for (const [index, label] of labels.entries()) {
      expect(obstacles.some((obstacle) => overlaps(label, obstacle))).toBe(false)
      expect(labels.slice(index + 1).some((other) => overlaps(label, other))).toBe(false)
    }
  })

  it('keeps long names within map edges', () => {
    const candidates = [candidate('left', 16, 30), candidate('right', 398, 260)]
    const placed = layoutMapLabels(candidates, bounds, candidates.map((entry) => entry.anchor))
    expect(placed.size).toBe(2)
    for (const label of placed.values()) {
      expect(label.x).toBeGreaterThanOrEqual(bounds.x)
      expect(label.x + label.width).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(label.y + label.height).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  })

  it('keeps crowded visible captions and their hover targets stable when focus changes', () => {
    // Dimensions include the action line, whether or not it is currently shown.
    const candidates = [candidate('actor', 105, 100, 30), candidate('prop', 100, 136, 25), candidate('landmark', 96, 64, 15)]
    const obstacles = candidates.map((entry) => entry.anchor)
    const initial = layoutMapLabels(candidates, bounds, obstacles)
    expect(initial.size).toBe(candidates.length)
    for (const [id, rect] of initial) {
      const pointer = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      let focused: string | undefined = id
      for (let move = 0; move < 10; move += 1) {
        const placed = layoutMapLabels(candidates, bounds, obstacles, focused)
        expect(placed).toEqual(initial)
        focused = selectHitTargetId([...placed].map(([targetId, targetBounds]) => ({
          id: targetId, bounds: targetBounds,
          position: { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height / 2 },
        })), pointer) ?? undefined
        expect(focused).toBe(id)
      }
    }
  })

  it('hides excess captions, then gives the focused object first choice', () => {
    const crowded = Array.from({ length: 12 }, (_, i) => candidate(`${i}`, 70, 70))
    const small = { x: 0, y: 0, width: 160, height: 160 }
    const initial = layoutMapLabels(crowded, small, crowded.map((entry) => entry.anchor))
    expect(initial.size).toBeLessThan(crowded.length)
    const hidden = crowded.find((entry) => !initial.has(entry.id))!
    const obstacles = crowded.map((entry) => entry.anchor)
    const promoted = layoutMapLabels(crowded, small, obstacles, hidden.id)
    expect(promoted.has(hidden.id)).toBe(true)
    expect(layoutMapLabels([...crowded].reverse(), small, obstacles, hidden.id)).toEqual(promoted)
    expect(layoutMapLabels(crowded, small, obstacles)).toEqual(initial)
  })
})
