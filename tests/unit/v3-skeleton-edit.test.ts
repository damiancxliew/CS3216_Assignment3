import { describe, expect, it } from "vitest";

import { checkSkeleton, validateSkeleton } from "@adventure/spec-v3";

import { addItem, allIds, dependentsOf, issuesAt, newId, removeItem } from "@/lib/v3/skeleton-edit";
import { goldenSkeleton } from "@/lib/v3/generation/fake-passes";

const skeleton = goldenSkeleton(
  // validated via fake-passes (the golden spec is already valid)
  JSON.parse(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../fixtures/golden-1819.json"), "utf8"),
  ),
);

describe("skeleton-edit helpers", () => {
  it("newId makes unique readable ids", () => {
    const ids = allIds(skeleton);
    const id = newId("char", ids);
    expect(id).toMatch(/^char-[0-9a-f]{4}$/);
    expect(ids.has(id)).toBe(false);
  });

  it.each(["character", "stage", "discovery", "document", "ending"] as const)("addItem(%s) keeps the skeleton schema-valid", (kind) => {
    const next = addItem(skeleton, kind);
    expect(validateSkeleton(next).ok).toBe(true);
  });

  it("addItem(stage) creates its moment and room; checkSkeleton flags only the new stage's gaps", () => {
    const next = addItem(skeleton, "stage");
    const newStage = next.stages.at(-1)!;
    const newMoment = next.definingMoments.find((m) => m.id === newStage.definingMomentId)!;
    expect(newMoment.acts).toHaveLength(1);
    expect(newMoment.outcomes).toHaveLength(1);
    expect(newMoment.rules).toEqual([{ actId: newMoment.acts[0]!.id, outcomeId: newMoment.outcomes[0]!.id }]);
    expect(newStage.rooms).toHaveLength(1);
    expect(newStage.startRoomId).toBe(newStage.rooms[0]!.id);

    const errors = checkSkeleton(next).errors;
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("core-missing");
    expect(codes).toContain("room-count");
    // every error is about the new stage, its moment or the global ending rules —
    // nothing pre-existing broke, and nothing is a dangling reference on old items
    const newStageIndex = next.stages.length - 1;
    const newMomentIndex = next.definingMoments.indexOf(newMoment);
    for (const error of errors) {
      const allowed =
        error.path.startsWith(`stages.${newStageIndex}`) ||
        error.path.startsWith(`definingMoments.${newMomentIndex}`) ||
        error.path === "endings";
      expect(allowed, `${error.path}: ${error.message}`).toBe(true);
    }
    expect(codes).not.toContain("duplicate-id");
  });

  it("addItem(room) needs a stage ref; act/outcome/rule need their moment", () => {
    const stage = skeleton.stages[0]!;
    const moment = skeleton.definingMoments.find((m) => m.id === stage.definingMomentId)!;
    const withRoom = addItem(skeleton, "room", `stage:${stage.id}`);
    expect(validateSkeleton(withRoom).ok).toBe(true);
    const withAct = addItem(skeleton, "act", `moment:${moment.id}`);
    expect(validateSkeleton(withAct).ok).toBe(true);
    const withOutcome = addItem(skeleton, "outcome", `moment:${moment.id}`);
    expect(validateSkeleton(withOutcome).ok).toBe(true);
    const withRule = addItem(skeleton, "rule", `moment:${moment.id}`);
    expect(validateSkeleton(withRule).ok).toBe(true);
  });

  it("dependentsOf a character lists its discoveries and placements", () => {
    const heldBy = skeleton.characters.find((c) => skeleton.discoveries.some((d) => "characterId" in d.holder && d.holder.characterId === c.id))!;
    const dependents = dependentsOf(skeleton, `character:${heldBy.id}`);
    expect(dependents.length).toBeGreaterThan(0);
    expect(dependents.some((d) => d.ref.startsWith("discovery:"))).toBe(true);
  });

  it("removeItem(stage) removes its moment and rooms", () => {
    const stage = skeleton.stages[0]!;
    const next = removeItem(skeleton, `stage:${stage.id}`);
    expect(next.stages.some((s) => s.id === stage.id)).toBe(false);
    expect(next.definingMoments.some((m) => m.id === stage.definingMomentId)).toBe(false);
  });

  it("removeItem(act) removes its rules", () => {
    const moment = skeleton.definingMoments[0]!;
    const act = moment.acts[0]!;
    const next = removeItem(skeleton, `act:${moment.id}/${act.id}`);
    const nextMoment = next.definingMoments.find((m) => m.id === moment.id)!;
    expect(nextMoment.acts.some((a) => a.id === act.id)).toBe(false);
    expect(nextMoment.rules.some((r) => r.actId === act.id)).toBe(false);
  });

  it("issuesAt matches exact prefixes, not siblings (stages.1 ≠ stages.10)", () => {
    const issues = [
      { code: "x", path: "stages.1.rooms.0.id", message: "m" },
      { code: "x", path: "stages.10.title", message: "m" },
      { code: "x", path: "stages.1", message: "m" },
    ];
    const at = issuesAt(issues, "stages.1");
    expect(at).toHaveLength(2);
    expect(at.some((i) => i.path === "stages.10.title")).toBe(false);
  });
});
