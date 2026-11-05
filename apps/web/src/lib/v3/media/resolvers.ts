import type {
  AdventureSpec,
  ImageSelection,
  MediaSnapshot,
} from "@adventure/spec-v3";
import {
  CHARACTERS,
  PLAYER_CHARACTER,
  characterFor,
  walkSheetUrl,
  type Character,
} from "@/lib/play/appearance";
import { stageArtUrl, v3StageArtBase } from "@/lib/play/v3/stage-art";
import { portraitUrl, versionedPortraitBase } from "@/lib/play/v3/portraits";
export type MediaTarget = {
  kind: "stage" | "portrait" | "playerSprite" | "characterSprite";
  key: string;
};
export type ReadyCandidate = {
  id: string;
  adventureId: string;
  target: MediaTarget;
  snapshot: MediaSnapshot;
};
export type MediaEditContext = { candidates?: Record<string, ReadyCandidate> };
export function portraitKeys(spec: AdventureSpec) {
  return spec.characters.flatMap((c) =>
    c.tier === "major" ? c.stances.map((s) => `${c.id}:${s.id}`) : [c.id],
  );
}
/** Exact membership avoids confusing character IDs with shared prefixes. */
export function characterPortraitKeys(spec: Pick<AdventureSpec, "characters">, key: string): string[] {
  for (const character of spec.characters) {
    const keys = character.tier === "major"
      ? character.stances.map(stance => `${character.id}:${stance.id}`)
      : [character.id];
    if (keys.includes(key)) return keys;
  }
  return [];
}
export function validTarget(spec: AdventureSpec, target: MediaTarget): boolean {
  if (target.kind === "stage")
    return spec.stages.some((s) => s.id === target.key);
  if (target.kind === "portrait")
    return portraitKeys(spec).includes(target.key);
  if (target.kind === "playerSprite") return target.key === "player";
  return (
    target.key.startsWith("character:") &&
    spec.characters.some((c) => `character:${c.id}` === target.key)
  );
}
export function isSprite(target: MediaTarget) {
  return target.kind === "playerSprite" || target.kind === "characterSprite";
}
export function bundledId(value: string): Character {
  if (!(CHARACTERS as readonly string[]).includes(value))
    throw Error("Unknown bundled sprite.");
  return value as Character;
}
export type ResolvedWalkingSprite = {
  sprite: Character;
  spriteSheetUrl: string;
  selection: "default" | "bundled" | "custom";
  metadata?: MediaSnapshot;
};
/** Character-level only: no stage or stance participates in this resolution. */
export function resolveWalkingSprites(
  spec: Pick<AdventureSpec, "characters" | "authoring">,
): Record<string, ResolvedWalkingSprite> {
  const defaults: [string, Character][] = [
    ["player", PLAYER_CHARACTER],
    ...spec.characters.map(
      (c) =>
        [
          `character:${c.id}`,
          characterFor({ id: c.id, name: c.name, role: c.title }),
        ] as [string, Character],
    ),
  ];
  return Object.fromEntries(
    defaults.map(([key, fallback]) => {
      const selection = spec.authoring?.walkingSprites?.[key];
      if (!selection)
        return [
          key,
          {
            sprite: fallback,
            spriteSheetUrl: walkSheetUrl(fallback),
            selection: "default",
          },
        ];
      const savedFallback = (CHARACTERS as readonly string[]).includes(
        selection.fallback,
      )
        ? (selection.fallback as Character)
        : fallback;
      if (selection.type === "custom")
        return [
          key,
          {
            sprite: savedFallback,
            spriteSheetUrl: selection.candidate.url,
            selection: "custom",
            metadata: selection.candidate,
          },
        ];
      const sprite = (CHARACTERS as readonly string[]).includes(
        selection.bundledId,
      )
        ? (selection.bundledId as Character)
        : savedFallback;
      return [
        key,
        { sprite, spriteSheetUrl: walkSheetUrl(sprite), selection: "bundled" },
      ];
    }),
  );
}
export type ResolvedImage = {
  url: string | null;
  version: number | null;
  metadata?: MediaSnapshot;
  selection: "default" | "fallback" | "candidate" | "legacy";
};
function imageSelection(
  selection: ImageSelection | undefined,
  legacyUrl: string | null,
  version: number | null,
): ResolvedImage {
  if (!selection) return { url: legacyUrl, version, selection: "default" };
  if (selection.type === "fallback")
    return { url: null, version: null, selection: "fallback" };
  if (selection.type === "legacy")
    return {
      url: selection.url,
      version: selection.version,
      selection: "legacy",
    };
  return {
    url: selection.candidate.url,
    version: null,
    metadata: selection.candidate,
    selection: "candidate",
  };
}
export function resolveStageImage(
  spec: AdventureSpec,
  adventureId: string,
  version: number,
  stageId: string,
): ResolvedImage {
  const index = spec.stages.findIndex((s) => s.id === stageId);
  return imageSelection(
    spec.authoring?.stageImages?.[stageId],
    index < 0 ? null : stageArtUrl(v3StageArtBase(adventureId, version), index),
    version,
  );
}
export function resolvePortraitImage(
  spec: AdventureSpec,
  adventureId: string,
  version: number,
  key: string,
): ResolvedImage {
  const sourceVersion = spec.authoring?.portraitVersions
    ? (spec.authoring.portraitVersions[key] ?? null)
    : version;
  return imageSelection(
    spec.authoring?.portraitImages?.[key],
    portraitUrl(
      key,
      versionedPortraitBase(
        adventureId,
        version,
        spec.authoring?.portraitVersions,
      ),
    ),
    sourceVersion,
  );
}
/** Capture positional legacy files before a structural edit can reorder their stages. */
export function preserveLegacyStageImages(
  spec: AdventureSpec,
  adventureId: string,
  version: number,
  stageUrls?: Record<string, string | null>,
): AdventureSpec {
  const copy = structuredClone(spec);
  const selections = ((copy.authoring ??= {}).stageImages ??= {});
  for (const stage of spec.stages)
    if (!selections[stage.id])
      selections[stage.id] = {
        type: "legacy",
        url:
          stageUrls && Object.hasOwn(stageUrls, stage.id)
            ? stageUrls[stage.id]!
            : resolveStageImage(spec, adventureId, version, stage.id).url,
        version,
      };
  return copy;
}
export function pruneMediaSelections(spec: AdventureSpec) {
  if (!spec.authoring) return;
  for (const [field, kind] of [
    ["stageImages", "stage"],
    ["portraitImages", "portrait"],
    ["walkingSprites", "characterSprite"],
  ] as const) {
    const map = spec.authoring[field];
    for (const key of Object.keys(map ?? {}))
      if (
        !(field === "walkingSprites" && key === "player") &&
        !validTarget(spec, { kind, key })
      )
        delete map![key];
  }
}

/** Storage coordinates are for staff persistence, not the public presentation projection. */
export function publicMediaSnapshot(snapshot: MediaSnapshot): MediaSnapshot {
  const publicMetadata = { ...snapshot };
  delete publicMetadata.storageKey;
  return publicMetadata;
}
function publicImage(image: ResolvedImage): ResolvedImage {
  return image.metadata
    ? { ...image, metadata: publicMediaSnapshot(image.metadata) }
    : image;
}

export function resolveAdventureImages(
  spec: AdventureSpec,
  adventureId: string,
  version: number,
) {
  return {
    stageImages: spec.stages.map((stage) =>
      publicImage(resolveStageImage(spec, adventureId, version, stage.id)),
    ),
    portraitBase: {
      selected: Object.fromEntries(
        portraitKeys(spec).map((key) => [
          key,
          publicImage(resolvePortraitImage(spec, adventureId, version, key)),
        ]),
      ),
    },
  };
}
