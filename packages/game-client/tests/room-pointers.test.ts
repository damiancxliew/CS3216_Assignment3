import { describe, expect, it } from 'vitest'
import { overlaps } from '../src/map-labels.js'
import { edgePoint, layoutRoomPointers } from '../src/room-pointers.js'

describe('room pointers', () => {
  const view = { x: 100, y: 100, width: 200, height: 120 }
  const inside = (rect: { x: number; y: number; width: number; height: number }) =>
    rect.x >= view.x && rect.y >= view.y && rect.x + rect.width <= view.x + view.width && rect.y + rect.height <= view.y + view.height

  it('points only at places outside the view', () => {
    expect(edgePoint(view, { x: 150, y: 150 })).toBeNull()
    expect(layoutRoomPointers([{ id: 'here', target: { x: 150, y: 150 }, width: 30, height: 10 }], view)).toEqual([])
  })

  it('pins the arrow to the edge facing the place', () => {
    expect(edgePoint(view, { x: 0, y: 160 })?.edge).toBe('left')
    expect(edgePoint(view, { x: 600, y: 170 })?.edge).toBe('right')
    expect(edgePoint(view, { x: 210, y: -50 })?.edge).toBe('top')
    expect(edgePoint(view, { x: 190, y: 500 })?.edge).toBe('bottom')
    const [pointer] = layoutRoomPointers([{ id: 'east', target: { x: 600, y: 160 }, width: 30, height: 10 }], view)
    expect(pointer!.edge).toBe('right')
    expect(Math.cos(pointer!.angle)).toBeGreaterThan(0.99)
    expect(pointer!.bounds.x + pointer!.bounds.width).toBe(view.x + view.width - 3)
  })

  it('keeps every chip inside the view and apart from the others', () => {
    const candidates = Array.from({ length: 6 }, (_, index) => ({ id: `room-${index}`, target: { x: -40, y: 150 + index }, width: 40, height: 10 }))
    const placed = layoutRoomPointers(candidates, view)
    expect(placed).toHaveLength(6)
    for (const pointer of placed) {
      expect(inside(pointer.bounds)).toBe(true)
      for (const other of placed) if (other !== pointer) expect(overlaps(pointer.bounds, other.bounds, 0)).toBe(false)
    }
  })

  it('slides clear of captions already on screen', () => {
    const caption = { x: 260, y: 150, width: 40, height: 16 }
    const [pointer] = layoutRoomPointers([{ id: 'east', target: { x: 600, y: 160 }, width: 30, height: 10 }], view, [caption])
    expect(pointer!.edge).toBe('right')
    expect(overlaps(pointer!.bounds, caption, 0)).toBe(false)
  })
})
