import type { LandmarkKind, MapLandmark, Point, StageMap } from './types.js'

export const LANDMARK_KINDS: readonly LandmarkKind[] = ['table', 'monument', 'tree', 'well', 'stall', 'dock', 'hearth', 'shelf']

/** Map an authored feature to a reusable physical tile fixture. */
export function landmarkKindFor(name: string, description: string, roomKind: string): LandmarkKind {
  const classify = (text: string): LandmarkKind | null => {
    const subject = text.toLowerCase()
    if (/\b(tree|grove|forest|oak|palm|garden|woodland)\b/.test(subject)) return 'tree'
    if (/\b(well|fountain|spring|cistern|water source)\b/.test(subject)) return 'well'
    if (/\b(stall|market|bazaar|cart|booth|trading post)\b/.test(subject)) return 'stall'
    if (/\b(fire|hearth|forge|kiln|oven|campfire)\b/.test(subject)) return 'hearth'
    if (/\b(shelf|archive|bookcase|library|cabinet|records?)\b/.test(subject)) return 'shelf'
    if (/\b(table|desk|altar|counter|charter|treaty|bench)\b/.test(subject)) return 'table'
    if (/\b(dock|pier|quay|wharf|jetty|landing|boat|ship|harbour|harbor)\b/.test(subject)) return 'dock'
    if (/\b(statue|memorial|monument|column|pillar|obelisk|shrine|gate|arch)\b/.test(subject)) return 'monument'
    return null
  }
  const fromText = classify(name) ?? classify(description)
  if (fromText) return fromText
  switch (roomKind) {
    case 'market': return 'stall'
    case 'dock': return 'dock'
    case 'field': return 'tree'
    case 'kitchen': case 'camp': return 'hearth'
    case 'archive': case 'office': return 'shelf'
    case 'courtyard': return 'well'
    default: return 'monument'
  }
}

export function landmarkCovers(landmark: MapLandmark, point: Point): boolean {
  return point.x >= landmark.x && point.x < landmark.x + landmark.width && point.y >= landmark.y && point.y < landmark.y + landmark.height
}

export function landmarkAt(map: StageMap, point: Point): MapLandmark | undefined {
  return map.landmarks?.find((landmark) => landmarkCovers(landmark, point))
}
