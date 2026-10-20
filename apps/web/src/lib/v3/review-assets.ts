import type { AdventureSpec } from "@adventure/spec-v3";
import { stageArtUrl, v3StageArtBase } from "@/lib/play/v3/stage-art";
import { portraitUrl, versionedPortraitBase } from "@/lib/play/v3/portraits";

export type ReviewAsset = {
  id: string;
  kind: "stage" | "portrait";
  title: string;
  description: string;
  url: string | null;
  version: number | null;
};

/** Use the same saved-version URLs and portrait inheritance as student play. */
export function reviewAssets(spec: AdventureSpec, adventureId: string, version: number): ReviewAsset[] {
  const stageBase = v3StageArtBase(adventureId, version);
  const portraits = versionedPortraitBase(adventureId, version, spec.authoring?.portraitVersions);
  return [
    ...spec.stages.map((stage, index): ReviewAsset => ({
      id: stage.id,
      kind: "stage",
      title: `Stage ${index + 1}: ${stage.title}`,
      description: stage.timePlace,
      url: stageArtUrl(stageBase, index),
      version,
    })),
    ...spec.characters.flatMap((character) =>
      (character.tier === "major" ? character.stances : [null]).map((stance): ReviewAsset => {
        const key = stance ? `${character.id}:${stance.id}` : character.id;
        return {
          id: key,
          kind: "portrait",
          title: stance ? `${character.name} · ${stance.label}` : character.name,
          description: stance?.demeanour ?? character.title,
          url: portraitUrl(key, portraits),
          version: spec.authoring?.portraitVersions
            ? spec.authoring.portraitVersions[key] ?? null
            : version,
        };
      }),
    ),
  ];
}
