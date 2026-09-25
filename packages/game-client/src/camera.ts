/** Integer magnification keeps each source-art pixel crisp and makes 16px actors
 * 48px on compact screens and at least 64px on desktop. The camera follows travel. */
export function detailZoom(width: number, height: number, mapWidth: number, mapHeight: number): number {
  const fit = Math.min(width / mapWidth, height / mapHeight)
  return Math.max(width < 600 ? 3 : 4, Math.min(8, Math.round(fit * 1.7)))
}

/** A small preview frame (the landing hero) shows the stage, not the player's surroundings:
 * the map's full width, following the player vertically. Never below half size or above 2×. */
export function overviewZoom(width: number, mapWidth: number): number {
  return Math.max(0.5, Math.min(2, width / mapWidth))
}
