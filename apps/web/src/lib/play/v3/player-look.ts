import { CHARACTERS, characterFor, facesetUrl, PLAYER_CHARACTER, walkSheetUrl, type Character } from "@/lib/play/appearance";
import type { V3StageScenery } from "./scenery";

/**
 * How the student's own character looks: one answer for the role card, the role brief and the map.
 *
 * In order of preference:
 *  1. the adventure's own player sprite (`authoring.walkingSprites.player`, picked or uploaded in the
 *     teacher's media review): a custom 4×4 sheet is cropped to its front-facing frame, a bundled pick
 *     uses that character's face;
 *  2. a standalone scene's authored player sheet;
 *  3. a bundled character matched to the role's position and the period, so a 1942 officer is not
 *     drawn as a grinning village boy.
 */
export type PlayerLook = {
  character: Character;
  /** A square face image (bundled faceset), when one exists. */
  faceUrl: string | null;
  /** A 4×4 walking sheet whose first (front-facing) frame is cropped when there is no face image. */
  sheetUrl: string | null;
  source: "custom-sprite" | "chosen-sprite" | "authored-sheet" | "role-match";
};

/** Pre-modern look-alikes (armour, ninja headband, robes) that read wrong from the 19th century on. */
const OUT_OF_PERIOD: ReadonlySet<Character> = new Set(["Knight", "Hunter", "Monk", "Monk2", "Sultan2"]);

/** Role words -> fitting looks for the player, first match wins. */
const PLAYER_HINTS: [RegExp, Character[], Character[]?][] = [
  // [pattern, modern options, pre-modern options]
  [/\b(officer|lieutenant|captain|major|colonel|general|liaison|aide|adjutant|army|military|soldier|sepoy|private|sergeant|corporal|guard|police|constable|trooper|regiment)\b/i, ["Inspector", "Noble", "Master"], ["Knight", "Inspector", "Hunter"]],
  [/\b(reporter|journalist|detective|spy|agent|photographer|writer|editor)\b/i, ["Noble", "Inspector"]],
  [/\b(nurse|doctor|medic|volunteer)\b/i, ["Woman", "Villager3"]],
  [/\b(queen|princess|lady|madam|wife|daughter|girl|mother|sister|woman)\b/i, ["Woman", "Princess"]],
  [/\b(sultan|raja|king|prince|noble|governor|resident)\b/i, ["Noble", "Sultan"], ["Sultan", "Noble"]],
  [/\b(merchant|trader|shopkeeper|towkay|dealer|broker|businessman)\b/i, ["Villager2", "Villager4", "Village6"]],
  [/\b(monk|priest|imam|cleric|missionary|scholar|teacher)\b/i, ["OldMan", "Master"], ["Monk", "Monk2"]],
  [/\b(farmer|fisherman|boatman|labourer|laborer|worker|miner|villager|peasant|sailor|coolie)\b/i, ["Villager", "Villager3", "Villager5"]],
  [/\b(clerk|apprentice|student|boy|interpreter|assistant|scribe|runner|messenger|servant|child)\b/i, ["Boy", "Villager3"]],
];

/** The earliest four-digit year in the setting, if any. */
function yearOf(text: string): number | null {
  const years = [...text.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((match) => Number(match[1]));
  return years.length ? Math.min(...years) : null;
}

/**
 * A bundled character for the player, matched to their position and period. Looks already worn by
 * people on the map are skipped when the role has an alternative, so the student can find themself.
 */
export function playerCharacterFor(
  role: { name: string; position: string },
  context: string,
  taken: ReadonlySet<string> = new Set(),
): Character {
  const year = yearOf(context);
  const modern = year === null || year >= 1800;
  const text = role.position;
  for (const [pattern, modernOptions, olderOptions] of PLAYER_HINTS) {
    if (!pattern.test(text)) continue;
    const options = (modern ? modernOptions : olderOptions ?? modernOptions).filter((option) => !modern || !OUT_OF_PERIOD.has(option));
    if (!options.length) continue;
    return options.find((option) => !taken.has(option)) ?? options[0]!;
  }
  const fallback = characterFor({ id: "player", name: role.name, role: role.position });
  if (modern && OUT_OF_PERIOD.has(fallback)) return PLAYER_CHARACTER;
  return fallback;
}

/** Characters already used by the people in this scenery, so the player does not look like one of them. */
export function takenLooks(scenery: V3StageScenery | undefined): Set<string> {
  return new Set(Object.entries(scenery?.walkingSprites ?? {}).filter(([key]) => key !== "player").map(([, sprite]) => sprite.sprite));
}

export function resolvePlayerLook({ briefing, context, scenery, taken }: {
  briefing: { name: string; position: string };
  /** Visible setting: stage time and place, plus the role's situation. */
  context: string;
  scenery?: V3StageScenery;
  /** Looks worn by people on the map; defaults to this scenery's cast. */
  taken?: ReadonlySet<string>;
}): PlayerLook {
  const chosen = scenery?.walkingSprites?.player;
  if (chosen?.selection === "custom") {
    return { character: chosen.sprite, faceUrl: null, sheetUrl: chosen.spriteSheetUrl, source: "custom-sprite" };
  }
  if (chosen?.selection === "bundled" && (CHARACTERS as readonly string[]).includes(chosen.sprite)) {
    return { character: chosen.sprite, faceUrl: facesetUrl(chosen.sprite), sheetUrl: walkSheetUrl(chosen.sprite), source: "chosen-sprite" };
  }
  const authored = scenery?.authored?.playerSheet;
  if (authored) return { character: chosen?.sprite ?? PLAYER_CHARACTER, faceUrl: null, sheetUrl: authored, source: "authored-sheet" };
  const character = playerCharacterFor(briefing, context, taken ?? takenLooks(scenery));
  return { character, faceUrl: facesetUrl(character), sheetUrl: walkSheetUrl(character), source: "role-match" };
}

/**
 * The same scenery with the player's default walking sheet replaced by the role-matched look, so the
 * map walks the person on the role card. Explicit picks and authored sheets are left alone.
 */
export function withPlayerLook(scenery: V3StageScenery | undefined, look: PlayerLook): V3StageScenery | undefined {
  if (!scenery || look.source !== "role-match") return scenery;
  const current = scenery.walkingSprites?.player;
  if (current && current.selection !== "default") return scenery;
  if (current?.sprite === look.character) return scenery;
  return {
    ...scenery,
    walkingSprites: {
      ...scenery.walkingSprites,
      player: { sprite: look.character, spriteSheetUrl: walkSheetUrl(look.character), selection: "default" },
    },
  };
}
