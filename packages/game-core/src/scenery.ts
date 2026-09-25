import type { Point, StageMap } from './types.js'
export const SCENERY_KINDS = ['planter', 'bench', 'lamp', 'crate', 'barrel', 'rope', 'pottery', 'awning', 'palm', 'boulder', 'log', 'fern', 'pipe', 'sacks', 'brazier', 'column', 'rubble', 'sandbags', 'bicycle', 'noticeboard', 'flowerbed', 'cart', 'fishing-net', 'bollard', 'canopy', 'laundry', 'urn', 'cypress', 'buoy', 'anchor'] as const
export type SceneryKind = typeof SCENERY_KINDS[number]
export function sceneryAt(map: StageMap, point: Point): boolean {
  return Boolean(map.scenery?.some(item => item.x === point.x && item.y === point.y))
}
