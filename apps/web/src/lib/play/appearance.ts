/**
 * Which hand-drawn character from the curated pack backs each stakeholder.
 * The map uses generated identity art (or a sober monogram while it is
 * unavailable); these deterministic sheets remain useful for compatibility
 * and teacher-facing fallbacks. The pack (Ninja Adventure, CC0) lives under
 * `public/game/ninja`; see the LICENSE there.
 *
 * Portraits are the generated identity layer allowed by PRD D4. Terrain,
 * structures and UI remain curated so the generated art cannot break geometry.
 */
export const ASSET_BASE = "/game/ninja";

/** Every character folder copied from the pack (each has `walk.png` 4x4 @16px and `face.png` 38px). */
export const CHARACTERS = [
  "Villager",
  "Villager2",
  "Villager3",
  "Villager4",
  "Villager5",
  "Villager6",
  "Village6",
  "OldMan",
  "OldMan2",
  "OldMan3",
  "Woman",
  "Noble",
  "Sultan",
  "Sultan2",
  "Monk",
  "Monk2",
  "Inspector",
  "Master",
  "Hunter",
  "Knight",
  "Princess",
  "Boy",
] as const;
export type Character = (typeof CHARACTERS)[number];

export const PLAYER_CHARACTER: Character = "Boy";

/** Role words -> the characters that fit them. First match wins; ties broken by the id hash. */
const ROLE_HINTS: [RegExp, Character[]][] = [
  [/sultan|raja|king|emperor|prince\b/i, ["Sultan", "Sultan2", "Noble"]],
  [/queen|princess|lady|madam|wife|daughter/i, ["Princess", "Woman"]],
  [/temenggong|chief|elder|headman|patriarch|senior/i, ["OldMan", "OldMan2", "OldMan3"]],
  [/monk|priest|imam|abbot|cleric|missionary|scholar/i, ["Monk", "Monk2"]],
  [/major|captain|colonel|officer|resident|governor|commissioner|official|magistrate|inspector|envoy|agent|secretary/i, ["Inspector", "Knight", "Master"]],
  [/soldier|guard|sepoy|sergeant|warrior|bodyguard/i, ["Knight", "Hunter"]],
  [/merchant|trader|shopkeeper|kongsi|towkay|dealer|broker|company/i, ["Villager2", "Villager4", "Villager6", "Village6"]],
  [/farmer|fisherman|boatman|labourer|laborer|worker|miner|villager|peasant|sailor|crew/i, ["Villager", "Villager3", "Villager5", "Hunter"]],
  [/boy|child|apprentice|interpreter|clerk|student/i, ["Boy", "Villager3"]],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function characterFor(stakeholder: { id: string; name?: string | null; role?: string | null }): Character {
  const text = `${stakeholder.name ?? ""} ${stakeholder.role ?? ""}`;
  const h = hash(stakeholder.id);
  for (const [pattern, options] of ROLE_HINTS) {
    if (pattern.test(text)) return options[h % options.length]!;
  }
  const generic = CHARACTERS.filter((c) => c !== PLAYER_CHARACTER);
  return generic[h % generic.length]!;
}

export function walkSheetUrl(character: Character): string {
  return `${ASSET_BASE}/characters/${character}/walk.png`;
}

export function facesetUrl(character: Character): string {
  return `${ASSET_BASE}/characters/${character}/face.png`;
}
