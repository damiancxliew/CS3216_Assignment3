/** Integer magnification keeps each source-art pixel crisp and makes 16px actors
 * 48px in compact frames and at least 64px in large frames. With `laptopFrames`, a
 * frame under 900×600 (the v2 map beside its side panel on a laptop) is compact too.
 * The camera follows travel. */
export function detailZoom(width: number, height: number, mapWidth: number, mapHeight: number, laptopFrames = false): number {
  const fit = Math.min(width / mapWidth, height / mapHeight)
  const large = laptopFrames ? width >= 900 && height >= 600 : width >= 600
  return Math.max(large ? 4 : 3, Math.min(8, Math.round(fit * 1.7)))
}

export function scaledZoom(zoom: number, scale: number): number {
  return Math.max(1, Math.round(zoom * scale))
}

/** A small preview frame (the landing hero) shows the stage, not the player's surroundings:
 * the map's full width, following the player vertically. Never below half size or above 2×. */
export function overviewZoom(width: number, mapWidth: number): number {
  return Math.max(0.5, Math.min(2, width / mapWidth))
}
