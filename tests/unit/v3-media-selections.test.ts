import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AdventureSpec, type MediaSnapshot } from "@adventure/spec-v3";
import { reviewAssets } from "@/lib/v3/review-assets";
import { applyV3Edits, type V3Edit } from "@/lib/v3/edit/commands";
import {
  resolveWalkingSprites,
  resolveStageImage,
  resolvePortraitImage,
  preserveLegacyStageImages,
  type ReadyCandidate,
} from "@/lib/v3/media/resolvers";
const fixture = () =>
  AdventureSpec.parse(
    JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  );
const id = "00000000-0000-4000-8000-000000000001";
const snapshot: MediaSnapshot = {
  candidateId: id,
  origin: "upload",
  url: "https://assets.example/immutable.webp",
  format: "webp",
  caption: "Harbour",
  alt: "Harbour in 1819",
  credit: "Teacher",
};
describe("versioned asset selection", () => {
  it("requires a compatible server-resolved candidate", () => {
    const spec = fixture(),
      key = spec.stages[0].id;
    const edit: V3Edit = {
      type: "stageImage",
      targetKey: key,
      candidateId: id,
    };
    expect(() => applyV3Edits(spec, [edit], [])).toThrow(/candidate/i);
    const candidate: ReadyCandidate = {
      id,
      adventureId: "adventure",
      target: { kind: "portrait", key },
      snapshot,
    };
    expect(() =>
      applyV3Edits(spec, [edit], [], false, {
        candidates: { [id]: candidate },
      }),
    ).toThrow(/target/i);
    candidate.target.kind = "stage";
    const next = applyV3Edits(spec, [edit], [], false, {
      candidates: { [id]: candidate },
    });
    expect(resolveStageImage(next, "adventure", 2, key).url).toBe(snapshot.url);
    expect(spec.authoring?.stageImages).toBeUndefined();
  });
  it("keeps saved stage images through reorder and uses fallback on removal", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://assets.example");
    const spec = fixture();
    const preserved = preserveLegacyStageImages(spec, "adv", 1),
      key = spec.stages[0].id;
    preserved.stages.reverse();
    expect(resolveStageImage(preserved, "adv", 4, key).url).toContain(
      "/v1/stage-0.webp",
    );
    const next = applyV3Edits(
      preserved,
      [{ type: "stageImage", targetKey: key, candidateId: null }],
      [],
    );
    expect(resolveStageImage(next, "adv", 5, key).url).toBeNull();
    vi.unstubAllEnvs();
  });
  it("inventories player plus every character independently of portraits or stance", () => {
    const spec = fixture();
    const first = resolveWalkingSprites(spec);
    expect(Object.keys(first)).toHaveLength(spec.characters.length + 1);
    const next = applyV3Edits(
      spec,
      [
        {
          type: "walkingSprite",
          targetKey: "player",
          selection: { kind: "bundled", id: "Noble" },
        },
      ],
      [],
    );
    expect(resolveWalkingSprites(next).player.sprite).toBe("Noble");
    expect(first.player.sprite).toBe("Boy");
    for (const c of spec.characters)
      expect(resolveWalkingSprites(next)[`character:${c.id}`]).toEqual(
        first[`character:${c.id}`],
      );
  });
  it("overrides inherited portraits without changing character walking sheets", () => {
    const spec = fixture();
    const character = spec.characters.find(
      (character) => character.tier === "major",
    )!;
    if (character.tier !== "major")
      throw Error("Major character fixture required");
    const key = `${character.id}:${character.stances[0].id}`;
    spec.authoring = { portraitVersions: { [key]: 1 } };
    const walking = resolveWalkingSprites(spec);
    const candidate: ReadyCandidate = {
      id,
      adventureId: "adv",
      target: { kind: "portrait", key },
      snapshot,
    };
    const next = applyV3Edits(
      spec,
      [{ type: "portraitImage", targetKey: key, candidateId: id }],
      [],
      false,
      { candidates: { [id]: candidate } },
    );
    expect(resolvePortraitImage(next, "adv", 4, key).url).toBe(snapshot.url);
    expect(resolveWalkingSprites(next)).toEqual(walking);
    const removed = applyV3Edits(
      next,
      [{ type: "portraitImage", targetKey: key, candidateId: null }],
      [],
    );
    expect(resolvePortraitImage(removed, "adv", 5, key).url).toBeNull();
    expect(resolveWalkingSprites(removed)).toEqual(walking);
    const inherited = reviewAssets(spec, "adv", 4);
    const changed = structuredClone(spec);
    changed.authoring!.portraitVersions![key] = null;
    expect(
      reviewAssets(changed, "adv", 5, inherited).find(
        (asset) => asset.id === key,
      )?.url,
    ).toBeNull();
  });
  it("applies one portrait to all stances atomically without changing other characters", () => {
    const spec = fixture();
    const character = spec.characters.find(c => c.tier === "major")!;
    if (character.tier !== "major") throw Error("Major required");
    const key = `${character.id}:${character.stances[0].id}`;
    const next = applyV3Edits(spec, [{ type: "portraitImage", targetKey: key, candidateId: id, allStances: true }], [], false, {
      candidates: { [id]: { id, adventureId: "adv", target: { kind: "portrait", key }, snapshot } },
    });
    expect(Object.keys(next.authoring!.portraitImages!)).toEqual(character.stances.map(s => `${character.id}:${s.id}`));
    for (const stance of character.stances)
      expect(resolvePortraitImage(next, "adv", 2, `${character.id}:${stance.id}`).url).toBe(snapshot.url);
    expect(spec.authoring?.portraitImages).toBeUndefined();
  });
  it("generic authoring edits cannot fabricate snapshots", () => {
    expect(() =>
      applyV3Edits(
        fixture(),
        [
          {
            type: "set",
            path: ["authoring"],
            value: { stageImages: { madeUp: snapshot } },
          },
        ],
        [],
      ),
    ).toThrow(/Protected/);
  });
});
