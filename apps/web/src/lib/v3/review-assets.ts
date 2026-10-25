import type { AdventureSpec, MediaSnapshot } from "@adventure/spec-v3";
import {
  resolveStageImage,
  resolvePortraitImage,
  resolveWalkingSprites,
  type MediaTarget,
} from "./media/resolvers";

export type ReviewAsset = {
  id: string;
  kind: "stage" | "portrait" | "sprite";
  title: string;
  description: string;
  url: string | null;
  version: number | null;
  target?: MediaTarget;
  ownerKey?: string;
  origin?: MediaSnapshot["origin"] | "bundled" | "legacy";
  metadata?: MediaSnapshot;
  selection?: string;
  bundledId?: string;
};
/** All slots are visible, including actors sharing the same bundled sheet. */
export function reviewAssets(
  spec: AdventureSpec,
  adventureId: string,
  version: number,
  legacy: ReviewAsset[] = [],
): ReviewAsset[] {
  const previous = new Map(
    legacy.map((asset) => [`${asset.kind}:${asset.id}`, asset]),
  );
  const walking = resolveWalkingSprites(spec);
  const sprite = (
    key: string,
    title: string,
    description: string,
  ): ReviewAsset => {
    const resolved = walking[key]!;
    return {
      id: key,
      kind: "sprite",
      title,
      description,
      url: resolved.spriteSheetUrl,
      version: resolved.selection === "default" ? null : version,
      target: {
        kind: key === "player" ? "playerSprite" : "characterSprite",
        key,
      },
      ownerKey: key === "player" ? "player" : key.slice(10),
      origin: resolved.metadata?.origin ?? "bundled",
      metadata: resolved.metadata,
      selection: resolved.selection,
      bundledId: resolved.sprite,
    };
  };
  return [
    ...spec.stages.map((stage, index): ReviewAsset => {
      const saved = previous.get(`stage:${stage.id}`);
      const resolved =
        !spec.authoring?.stageImages?.[stage.id] && saved
          ? {
              url: saved.url,
              version: saved.version,
              selection: "default" as const,
              metadata: saved.metadata,
            }
          : resolveStageImage(spec, adventureId, version, stage.id);
      return {
        id: stage.id,
        kind: "stage",
        title: `Stage ${index + 1}: ${stage.title}`,
        description: stage.timePlace,
        ...resolved,
        ...(resolved.selection === "candidate" ? { version } : {}),
        ...(resolved.selection === "default" && saved
          ? { url: saved.url, version: saved.version }
          : {}),
        target: { kind: "stage", key: stage.id },
        ownerKey: stage.id,
        origin: resolved.metadata?.origin ?? "legacy",
      };
    }),
    ...spec.characters.flatMap((character) =>
      (character.tier === "major" ? character.stances : [null]).map(
        (stance): ReviewAsset => {
          const key = stance ? `${character.id}:${stance.id}` : character.id;
          const saved = previous.get(`portrait:${key}`);
          const inheritedVersion = spec.authoring?.portraitVersions
            ? (spec.authoring.portraitVersions[key] ?? null)
            : version;
          const resolved =
            !spec.authoring?.portraitImages?.[key] &&
            saved &&
            saved.version === inheritedVersion
              ? {
                  url: saved.url,
                  version: saved.version,
                  selection: "default" as const,
                  metadata: saved.metadata,
                }
              : resolvePortraitImage(spec, adventureId, version, key);
          return {
            id: key,
            kind: "portrait",
            title: stance
              ? `${character.name} · ${stance.label}`
              : character.name,
            description: stance?.demeanour ?? character.title,
            ...resolved,
            ...(resolved.selection === "candidate" ? { version } : {}),
            ...(resolved.selection === "default" && saved
              ? { url: saved.url, version: saved.version }
              : {}),
            target: { kind: "portrait", key },
            ownerKey: character.id,
            origin: resolved.metadata?.origin ?? "legacy",
          };
        },
      ),
    ),
    sprite("player", "Player", spec.role.position),
    ...spec.characters.map((character) =>
      sprite(`character:${character.id}`, character.name, character.title),
    ),
  ];
}
