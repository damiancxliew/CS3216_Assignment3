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

/**
 * The detail zoom, raised to the smallest whole step that leaves no empty band
 * beside the map. Whole steps keep pixel art crisp; the camera follows the player
 * across whatever extends offscreen.
 */
export function fillZoom(zoom: number, width: number, height: number, mapWidth: number, mapHeight: number): number {
  return Math.max(zoom, coverZoom(width, height, mapWidth, mapHeight))
}

/** Fill the viewport with the authored world; follow travel when its edges extend offscreen. */
export function coverZoom(width: number, height: number, mapWidth: number, mapHeight: number): number {
  return Math.max(1, Math.ceil(Math.max(width / mapWidth, height / mapHeight)))
}
