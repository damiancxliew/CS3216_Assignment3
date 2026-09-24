/** Use only the public place descriptions, never unrevealed story information.
 * These are presentation choices; collision and room geometry stay authoritative. */
export type RoomScenery = 'newsroom' | 'archive' | 'council' | 'workshop' | 'plain'

export function roomScenery(description: string): RoomScenery {
  if (/\b(newsroom|newspaper|city desk|photo morgue|wire booth|wire service|editorial|press room|shortwave|telegraph|radio)\b/i.test(description)) return 'newsroom'
  if (/\b(archive|library|records|drawer|files|file|shelf|shelves)\b/i.test(description)) return 'archive'
  if (/\b(council|court|assembly|chamber|negotiation|treaty|diplomat|embassy)\b/i.test(description)) return 'council'
  if (/\b(workshop|factory|forge|mill|printing press)\b/i.test(description)) return 'workshop'
  return 'plain'
}

export function usesUrbanGround(roomDescriptions: readonly string[]): boolean {
  return roomDescriptions.some((text) => roomScenery(text) === 'newsroom')
}

export type FixtureScenery = 'radio' | 'filing' | 'press' | 'desk' | null
export function fixtureScenery(description: string): FixtureScenery {
  if (/\b(radio|shortwave|wire booth|telegraph|receiver)\b/i.test(description)) return 'radio'
  if (/\b(drawer|filing|file cabinet|photo morgue)\b/i.test(description)) return 'filing'
  if (/\b(printing press|printing machine)\b/i.test(description)) return 'press'
  if (/\b(city desk|editor.*desk|news.*desk|wire basket|typewriter)\b/i.test(description)) return 'desk'
  return null
}
