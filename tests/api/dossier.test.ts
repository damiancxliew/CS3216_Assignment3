import type { AssetManifest, AssetRecord } from "@adventure/generation/assets";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { describe, expect, it } from "vitest";

import { facesetUrl, characterFor } from "@/lib/play/appearance";
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

    const person = dossier.stakeholders.find((s) => s.id === portrait.entityId)!;
    expect(person.imageStatus).toBe("generated");
    expect(person.imageUrl).toBe("https://example.test/img.png");

    const other = dossier.stakeholders.find((s) => s.id !== portrait.entityId)!;
    expect(other.imageStatus).toBe("placeholder");
    expect(other.imageUrl).toBe(facesetUrl(characterFor(spec.stakeholders.find((s) => s.id === other.id)!)));

    if (landmark) {
      const room = dossier.stages.flatMap((s) => s.rooms).find((r) => r.id === landmark.entityId)!;
      expect(room.imageStatus).toBe("pending");
      expect(room.imageUrl).toBeNull();
    }
    if (prop) {
      const item = dossier.stages.flatMap((s) => s.evidence).find((e) => e.id === prop.entityId)!;
      expect(item.imageStatus).toBe("failed");
      expect(item.imageUrl).toBeNull();
    }
  });

  it("keeps agents to their public half", async () => {
    const spec = await loadI1Spec();
    const dossier = dossierFromSpec(spec, null);
    for (const stage of dossier.stages) {
      for (const agent of stage.agents) {
        expect(Object.keys(agent).sort()).toEqual(["publicPosition", "stakeholderId"]);
      }
    }
  });
});
