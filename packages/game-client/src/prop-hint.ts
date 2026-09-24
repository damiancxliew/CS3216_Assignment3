import type { Point } from '@adventure/game-core'

export interface PropHintCandidate {
  id: string
  position: Point
}

export interface HitCandidate extends PropHintCandidate {
  bounds: { x: number; y: number; width: number; height: number }
}

/** Pick one nearby document to carry the room's generic interaction hint. */
export function selectPropHintId(props: readonly PropHintCandidate[], player: Point | null): string | null {
  if (!player || props.length === 0) return null

  let selected = props[0]!
  let selectedDistance = Math.abs(selected.position.x - player.x) + Math.abs(selected.position.y - player.y)

  for (const prop of props.slice(1)) {
    const distance = Math.abs(prop.position.x - player.x) + Math.abs(prop.position.y - player.y)
    if (distance < selectedDistance || (distance === selectedDistance && prop.id < selected.id)) {
      selected = prop
      selectedDistance = distance
    }
  }

  return selected.id
}

/** Resolve clicks against the whole visible prop (prompt, name and paper), not only its map tile. */
export function selectHitTargetId(targets: readonly HitCandidate[], pointer: Point): string | null {
  const hits = targets.filter(({ bounds }) => (
    pointer.x >= bounds.x
    && pointer.x <= bounds.x + bounds.width
    && pointer.y >= bounds.y
    && pointer.y <= bounds.y + bounds.height
  ))
  if (hits.length === 0) return null

  hits.sort((left, right) => {
    const leftDistance = (left.position.x - pointer.x) ** 2 + (left.position.y - pointer.y) ** 2
    const rightDistance = (right.position.x - pointer.x) ** 2 + (right.position.y - pointer.y) ** 2
    return leftDistance - rightDistance || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  })
  return hits[0]!.id
}
