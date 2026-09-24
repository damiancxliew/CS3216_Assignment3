import type { AssetManifest, AssetRecord } from "@adventure/generation/assets";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { describe, expect, it } from "vitest";

import { facesetUrl, characterFor } from "@/lib/play/appearance";
import { compileStageMap } from "@/lib/play/layout";
import { dossierFromSpec } from "@/lib/teacher/dossier";
import { findForbiddenKeys } from "@/lib/turn-api/contract";

function record(entry: { id: string; entityId: string; kind: AssetRecord["kind"] }, status: AssetRecord["status"], url = "https://example.test/img.png"): AssetRecord {
  return {
    assetId: entry.id,
    entityId: entry.entityId,
    kind: entry.kind,
    status,
    url,
    placeholderUrl: `/assets/curated/placeholder-${entry.kind}.png`,
    promptHash: "abc",
    model: status === "ready" ? "test-model" : null,
    costUsd: status === "ready" ? 0.02 : 0,
    error: null,
  };
}

function manifestFor(spec: Awaited<ReturnType<typeof loadI1Spec>>, records: AssetRecord[]): AssetManifest {
  return {
    adventureId: spec.id,
    specVersion: 1,
    records,
    generatedCount: records.filter((r) => r.status === "ready").length,
    cacheHits: 0,
    totalCostUsd: records.reduce((sum, r) => sum + r.costUsd, 0),
    startedAt: "",
    finishedAt: "",
  };
}

describe("dossier view model", () => {
  it("contains no forbidden keys (FR-21)", async () => {
    const spec = await loadI1Spec();
    const dossier = dossierFromSpec(spec, null);
    expect(dossier.assets.started).toBe(false);
    expect(findForbiddenKeys(dossier)).toEqual([]);
  });

  it("resolves generated urls and falls back to the faceset/placeholder otherwise", async () => {
    const spec = await loadI1Spec();
    const portrait = spec.assetEligibility.find((a) => a.kind === "portrait")!;
    const landmark = spec.assetEligibility.find((a) => a.kind === "landmark");
    const prop = spec.assetEligibility.find((a) => a.kind === "prop");

    const records = [record(portrait, "ready")];
    if (landmark) records.push(record(landmark, "pending"));
    if (prop) records.push(record(prop, "failed"));
    const dossier = dossierFromSpec(spec, manifestFor(spec, records));
    expect(dossier.assets.started).toBe(true);
    expect(dossier.assets.generated).toBe(1);
    expect(dossier.assets.pending).toBe(landmark ? 1 : 0);
    expect(dossier.artwork).toHaveLength(dossier.assets.eligible);
    expect(dossier.artwork.find((item) => item.id === portrait.id)).toMatchObject({ name: spec.stakeholders.find((s) => s.id === portrait.entityId)!.name, imageStatus: "generated", imageUrl: "https://example.test/img.png" });

    const person = dossier.stakeholders.find((s) => s.id === portrait.entityId)!;
    expect(person.imageStatus).toBe("generated");
    expect(person.imageUrl).toBe("https://example.test/img.png");

    const other = dossier.stakeholders.find((s) => s.id !== portrait.entityId)!;
    expect(other.imageStatus).toBe("placeholder");
    expect(other.imageUrl).toBe(facesetUrl(characterFor(spec.stakeholders.find((s) => s.id === other.id)!)));

    if (landmark) {
      const room = dossier.stages.flatMap((s) => s.rooms).find((r) => r.id === landmark.entityId)!;
      expect(room.imageStatus).toBe("pending");
      expect(room.imageUrl).toBe("/assets/curated/placeholder-landmark.png");
    }
    if (prop) {
      const item = dossier.stages.flatMap((s) => s.evidence).find((e) => e.id === prop.entityId)!;
      expect(item.imageStatus).toBe("failed");
      expect(item.imageUrl).toBe("/assets/curated/placeholder-prop.png");
    }
  });

  it("gives every room and evidence card bundled fallback artwork without a manifest", async () => {
    const spec = await loadI1Spec();
    const dossier = dossierFromSpec(spec, null);

    for (const room of dossier.stages.flatMap((stage) => stage.rooms)) {
      expect(room.imageStatus).toBe("placeholder");
      expect(room.imageUrl).toBe("/assets/curated/placeholder-landmark.png");
    }
    for (const item of dossier.stages.flatMap((stage) => stage.evidence)) {
      expect(item.imageStatus).toBe("placeholder");
      expect(item.imageUrl).toBe("/assets/curated/placeholder-prop.png");
    }
  });

  it("projects compiled stages into plans without the tile grid", async () => {
    const spec = await loadI1Spec();
    const compiled = spec.stages.map((stage) => compileStageMap(stage, "dossier-test"));
    const dossier = dossierFromSpec(spec, null, compiled);

    for (const [index, stage] of dossier.stages.entries()) {
      expect(stage.plan).not.toBeNull();
      expect(stage.plan!.width).toBe(compiled[index]!.map.width);
      expect(stage.plan!.rooms.length).toBeGreaterThan(0);
      expect("tiles" in stage.plan!).toBe(false);
      expect("seed" in stage.plan!).toBe(false);
    }
    expect(findForbiddenKeys(dossier)).toEqual([]);
  });

  it("yields plan null for every stage when compiled_stages is missing or garbage", async () => {
    const spec = await loadI1Spec();
    for (const value of [undefined, null, [], [{ map: {} }]]) {
      const dossier = dossierFromSpec(spec, null, value);
      expect(dossier.stages.every((s) => s.plan === null)).toBe(true);
    }
  });

  it("keeps agents to their public half", async () => {
    const spec = await loadI1Spec();
    const dossier = dossierFromSpec(spec, null);
    for (const stage of dossier.stages) {
      for (const agent of stage.agents) {
        expect(Object.keys(agent).sort()).toEqual(["id", "publicPosition", "stakeholderId"]);
      }
    }
  });
});
