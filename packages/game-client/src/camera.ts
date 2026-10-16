/** Integer magnification keeps each source-art pixel crisp and makes 16px actors
 * 48px in compact frames (phones, and the map beside the side panel on a laptop)
 * and at least 64px in large frames. The camera follows travel. */
export function detailZoom(width: number, height: number, mapWidth: number, mapHeight: number): number {
  const fit = Math.min(width / mapWidth, height / mapHeight)
  const minimum = width >= 900 && height >= 600 ? 4 : 3
  return Math.max(minimum, Math.min(8, Math.round(fit * 1.7)))
}

/** A small preview frame (the landing hero) shows the stage, not the player's surroundings:
 * the map's full width, following the player vertically. Never below half size or above 2×. */
export function overviewZoom(width: number, mapWidth: number): number {
  return Math.max(0.5, Math.min(2, width / mapWidth))
}
