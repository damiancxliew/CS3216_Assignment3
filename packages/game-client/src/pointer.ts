import type { Point } from '@adventure/game-core'

export function tileFromPointer(worldX: number, worldY: number, tileSize: number, width: number, height: number): Point | null {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(tileSize) || tileSize <= 0) return null
  const point = { x: Math.floor(worldX / tileSize), y: Math.floor(worldY / tileSize) }
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height ? point : null
}
