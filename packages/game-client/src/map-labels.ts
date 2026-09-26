export interface LabelRect { x: number; y: number; width: number; height: number }
export interface MapLabelCandidate {
  id: string
  anchor: LabelRect
  width: number
  height: number
  priority: number
  /** Only ever place directly above the anchor (walking characters), so the caption tracks it. */
  above?: boolean
}

export function overlaps(left: LabelRect, right: LabelRect, gap = 2): boolean {
  return left.x < right.x + right.width + gap && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap && left.y + left.height + gap > right.y
}

/** One shared layout for people, evidence and fixtures. When space runs out,
 * omit a lower-priority caption; focusing its object promotes it on the next pass.
 * Never shrink text or place one name over another to make it fit.
 * `blockers` are other text on the map (room names, speech bubbles) that no caption may cover,
 * not even one pinned above a walking character; `obstacles` only push unpinned captions aside. */
export function layoutMapLabels(candidates: readonly MapLabelCandidate[], bounds: LabelRect, obstacles: readonly LabelRect[], focusedId?: string, blockers: readonly LabelRect[] = []): Map<string, LabelRect> {
  const placed = new Map<string, LabelRect>()
  const occupied = [...obstacles, ...blockers]
  for (const item of [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const { anchor, width, height } = item
    const center = anchor.x + anchor.width / 2
    const positions: LabelRect[] = []
    for (const distance of item.above ? [3] : [3, 14, 26, 40, 56]) {
      if (item.above) {
        positions.push({ x: center - width / 2, y: anchor.y - height - distance, width, height })
        continue
      }
      positions.push(
        { x: center - width / 2, y: anchor.y + anchor.height + distance, width, height },
        { x: center - width / 2, y: anchor.y - height - distance, width, height },
        { x: anchor.x + anchor.width + distance, y: anchor.y + (anchor.height - height) / 2, width, height },
        { x: anchor.x - width - distance, y: anchor.y + (anchor.height - height) / 2, width, height },
      )
    }
    for (const position of positions) {
      // Keep walking names attached at fractional animation coordinates.
      // Hide crowded or clipped names instead of moving them away from the head.
      if (!item.above) {
        position.x = Math.round(Math.max(bounds.x, Math.min(position.x, bounds.x + bounds.width - width)))
        position.y = Math.round(position.y)
      }
      if (position.x < bounds.x || position.x + width > bounds.x + bounds.width
        || position.y < bounds.y || position.y + height > bounds.y + bounds.height) continue
      // Pinned captions only dodge other captions; scenery must not bump them around mid-walk.
      if ((item.above ? [...placed.values(), ...blockers] : occupied).some((rect) => overlaps(position, rect))) continue
      placed.set(item.id, position)
      occupied.push(position)
      break
    }
  }
  // Highlighting a visible caption must not rearrange the hit targets beneath
  // the pointer. Only promote focus when its caption would otherwise be hidden.
  if (focusedId && !placed.has(focusedId) && candidates.some((item) => item.id === focusedId)) {
    const priority = Math.max(...candidates.map((item) => item.priority)) + 1
    return layoutMapLabels(candidates.map((item) => item.id === focusedId ? { ...item, priority } : item), bounds, obstacles, undefined, blockers)
  }
  return placed
}
