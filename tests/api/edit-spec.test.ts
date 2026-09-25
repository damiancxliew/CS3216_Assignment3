import { compileAdventure } from "@adventure/game-integration";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { describe, expect, it } from "vitest";

import { applyEditToSpec, type SpecEdit } from "@/lib/teacher/edit-spec";

describe("applyEditToSpec", () => {
  it("renames a stakeholder in place, keeping its id and grounding", async () => {
    const spec = await loadI1Spec();
    const before = structuredClone(spec);
    const person = spec.stakeholders[0]!;
    const result = applyEditToSpec(spec, {
      kind: "stakeholder",
      stakeholderId: person.id,
      name: "Renamed Person",
      role: person.role,
      summary: person.summary.text,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.spec.stakeholders[0]!;
    expect(renamed.id).toBe(person.id);
    expect(renamed.name).toBe("Renamed Person");
    expect(renamed.summary.spans).toEqual(person.summary.spans);
    expect(renamed.summary.assumptionIds).toEqual(person.summary.assumptionIds);
    // Everything outside the edited stakeholder is deep-equal to the input.
    expect({ ...result.spec, stakeholders: spec.stakeholders.slice(1) }).toEqual({ ...before, stakeholders: before.stakeholders.slice(1) });
    expect(result.spec.stakeholders.slice(1)).toEqual(before.stakeholders.slice(1));
    expect(spec).toEqual(before);
  });

  it("edits a stage's shared context without disturbing its grounding", async () => {
    const spec = await loadI1Spec();
    const stage = spec.stages[0]!;
    const result = applyEditToSpec(spec, {
      kind: "stage",
      stageId: stage.id,
      title: stage.title,
      sharedContext: "A rewritten context.",
      timerSeconds: stage.timerSeconds,
      mapTheme: "forest",
      visualStyle: "jungle",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = result.spec.stages[0]!;
    expect(edited.sharedContext.text).toBe("A rewritten context.");
    expect(edited.sharedContext.spans).toEqual(stage.sharedContext.spans);
    expect(edited.sharedContext.assumptionIds).toEqual(stage.sharedContext.assumptionIds);
    expect(edited.mapTheme).toBe("forest");
    expect(edited.visualStyle).toBe("jungle");
  });

  it("rejects an over-long title with the issue's path, and leaves the input untouched", async () => {
    const spec = await loadI1Spec();
    const before = structuredClone(spec);
    const result = applyEditToSpec(spec, {
      kind: "stage",
      stageId: spec.stages[0]!.id,
      title: "x".repeat(200),
      sharedContext: spec.stages[0]!.sharedContext.text,
      timerSeconds: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("$.stages.0.title");
    expect(spec).toEqual(before);
  });

  it("rejects unknown ids rather than no-oping", async () => {
    const spec = await loadI1Spec();
    const cases: SpecEdit[] = [
      { kind: "stage", stageId: "nope", title: "t", sharedContext: "c", timerSeconds: null },
      { kind: "stakeholder", stakeholderId: "nope", name: "n", role: "r", summary: "s" },
      { kind: "room", stageId: spec.stages[0]!.id, roomId: "nope", name: "n", purpose: "p" },
      { kind: "objective", stageId: spec.stages[0]!.id, objectiveId: "nope", title: "t" },
      { kind: "assumption", assumptionId: "nope", text: "t", reason: "r" },
      { kind: "ending", endingId: "nope", title: "t", summary: "s", divergence: "d", reflectionQuestions: ["a", "b"] },
      {
        kind: "decision",
        stageId: spec.stages[0]!.id,
        title: spec.stages[0]!.decision.title,
        prompt: spec.stages[0]!.decision.prompt,
        optionLabels: [{ id: "nope", label: "x" }],
      },
    ];
    for (const edit of cases) {
      expect(applyEditToSpec(spec, edit).ok, JSON.stringify(edit)).toBe(false);
    }
  });

  it("rejects empty required text", async () => {
    const spec = await loadI1Spec();
    const stage = spec.stages[0]!;
    const cases: SpecEdit[] = [
      { kind: "stage", stageId: stage.id, title: "", sharedContext: stage.sharedContext.text, timerSeconds: null },
      {
        kind: "decision",
        stageId: stage.id,
        title: stage.decision.title,
        prompt: stage.decision.prompt,
        optionLabels: [{ id: stage.decision.options[0]!.id, label: "" }],
      },
      { kind: "ending", endingId: spec.endings[0]!.id, title: "T", summary: "", divergence: "d", reflectionQuestions: ["a", "b"] },
    ];
    for (const edit of cases) {
      expect(applyEditToSpec(spec, edit).ok, JSON.stringify(edit)).toBe(false);
    }
  });

  it("accepts null, 0 and 3600 for timerSeconds but rejects 3601 and -1", async () => {
    const spec = await loadI1Spec();
    const stage = spec.stages[0]!;
    const edit = (timerSeconds: number | null): SpecEdit => ({
      kind: "stage",
      stageId: stage.id,
      title: stage.title,
      sharedContext: stage.sharedContext.text,
      timerSeconds,
    });
    for (const ok of [null, 0, 3600]) {
      const result = applyEditToSpec(spec, edit(ok));
      expect(result.ok, String(ok)).toBe(true);
      if (result.ok) expect(result.spec.stages[0]!.timerSeconds).toBe(ok);
    }
    for (const bad of [3601, -1]) {
      expect(applyEditToSpec(spec, edit(bad)).ok, String(bad)).toBe(false);
    }
  });

  it("does not move the floor plan when prose changes", async () => {
    const spec = await loadI1Spec();
    const before = compileAdventure(spec, "fixed-seed");
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const stage = spec.stages[0]!;
    const edited = applyEditToSpec(spec, {
      kind: "stage",
      stageId: stage.id,
      title: "A retitled stage",
      sharedContext: "Different prose entirely.",
      timerSeconds: 120,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const after = compileAdventure(edited.spec, "fixed-seed");
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.stages[0]!.map.rooms).toEqual(before.stages[0]!.map.rooms);
    expect(after.stages[0]!.map.doors).toEqual(before.stages[0]!.map.doors);
  });
});
