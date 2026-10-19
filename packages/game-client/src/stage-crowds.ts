import { isWalkable, roomContains, type Point, type StageMap } from '@adventure/game-core'

/** Deterministic local flavour from public stage framing. Never an engine actor. */
export interface StageCrowd {
  kind: 'troops' | 'rioters' | 'patrol'
  name: string
  sprites: readonly string[]
  lines: readonly string[]
  movement: 'formation' | 'gathering' | 'patrol'
}

const TROOPS: StageCrowd = {
  kind: 'troops', name: 'Recruit', sprites: ['Knight', 'Inspector'], movement: 'formation',
  lines: ['Keep in step. We drill together until the turn is right.', 'There will be time to talk when the drill is over.'],
}
const RIOTERS: StageCrowd = {
  kind: 'rioters', name: 'Crowd member', sprites: ['Villager', 'Villager2', 'Villager3', 'Villager4', 'Villager5', 'Villager6'], movement: 'gathering',
  lines: ['Stay close. It is hard to hear over the crowd.', 'People keep gathering here. Watch your footing.'],
}
const PATROL: StageCrowd = {
  kind: 'patrol', name: 'Patrol officer', sprites: ['Inspector', 'Knight'], movement: 'patrol',
  lines: ['Keep the passage clear, please.', 'We are making another round of the street.'],
}

export const STAGE_CROWD_SPRITES = [...new Set([...TROOPS.sprites, ...RIOTERS.sprites, ...PATROL.sprites])]

/** Explicit crowd scenes take priority over incidental military words. */
export function stageCrowd(context: string): StageCrowd | null {
  if (/\b(riots?|rioters?|rioting|unrest|angry crowd|mob|protest(?:s|ers)?)\b/i.test(context)) return RIOTERS
  if (/\b(national service|conscription|conscripts?|recruits?|troops?|soldiers?|military drill|army|barracks)\b/i.test(context)) return TROOPS
  if (/\b(police|inspectors?|patrol|constables?)\b/i.test(context)) return PATROL
  return null
}

/** Six soldiers share one safe straight drill lane, with two ranks three abreast.
 * A narrow street may not have room: callers can fall back to ordinary outdoor routes.
 */
export function drillFormation(map: StageMap): Point[][] | null {
  const allowed = (x: number, y: number) => isWalkable(map, {}, { x, y })
    && !map.rooms.some(room => roomContains(room, { x, y }))
    && !map.doors.some(door => door.position.x === x && door.position.y === y)
  for (let y = 2; y < map.height - 7; y++) for (let x = 2; x < map.width - 4; x++) {
    if (!Array.from({ length: 18 }, (_, i) => allowed(x + i % 3, y + Math.floor(i / 3))).every(Boolean)) continue
    return Array.from({ length: 6 }, (_, i) => {
      const start = { x: x + i % 3, y: y + Math.floor(i / 3) * 2 }
      return [0, 1, 2, 3, 2, 1].map(dy => ({ x: start.x, y: start.y + dy }))
    })
  }
  return null
}

/** All callers use the same public context for asset loading and population. */
export function crowdForStage(snapshot: { crowdContext?: string; storyContext?: string; roomDescriptions?: Readonly<Record<string, string>> }): StageCrowd | null {
  if (snapshot.crowdContext === undefined) return null
  return stageCrowd([snapshot.crowdContext, snapshot.storyContext ?? '', ...Object.values(snapshot.roomDescriptions ?? {})].join(' '))
}
