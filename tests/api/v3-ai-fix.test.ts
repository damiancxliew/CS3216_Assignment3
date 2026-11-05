import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { FakeLlmClient } from "@adventure/generation/llm";
import { goldenSkeleton } from "@/lib/v3/generation/fake-passes";
import { proposeEditFix, proposeSkeletonFix, skeletonChanges, encodeEdit, fakeEditFixer } from "@/lib/v3/edit/ai-fix";
import { applySkeletonEdits } from "@/lib/v3/edit/skeleton";
import { checkTeacherEdits } from "@/lib/v3/edit/validation";
import type { V3Edit } from "@/lib/v3/edit/commands";

const base = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
const broken: V3Edit[] = [{ type: "set", path: ["definingMoments", 0, "nudge"], value: "" }];
const good: V3Edit[] = [{ type: "set", path: ["definingMoments", 0, "nudge"], value: "The teacher's nudge" }];
const reply = (edits: V3Edit[]) => ({ json: { edits: edits.map(encodeEdit), notes: "I restored the stage title." } });
const input = { base, edits: broken, sources: [] };

describe("Fix with AI", () => {
  it("decodes digit path segments and JSON values, and validates the proposal", async () => {
    const llm = new FakeLlmClient([reply(good)]);
    expect(await proposeEditFix({ llm }, input)).toEqual({ ok: true, edits: good, notes: "I restored the stage title." });
    expect(llm.requests[0]).toMatchObject({ schemaName: "edit_fix", maxOutputTokens: 8000, reasoningEffort: "low" });
    expect(llm.requests[0].user).toContain('<affected_parts>');
    expect(llm.requests[0].user).toContain('"path": "definingMoments.0"');
    expect(llm.requests[0].system).not.toContain(base.title);
  });
  it("retries once with the previous proposal and remaining errors", async () => {
    const llm = new FakeLlmClient([reply(broken), reply(good)]);
    expect(await proposeEditFix({ llm }, input)).toMatchObject({ ok: true, edits: good });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].user).toContain('<still_failing>');
    expect(llm.requests[1].user).toContain('<previous_attempt>');
  });
  it("returns no-fix after two invalid proposals", async () => {
    const llm = new FakeLlmClient([reply(broken), reply(broken)]);
    expect(await proposeEditFix({ llm }, input)).toMatchObject({ ok: false, code: "no-fix", errors: expect.arrayContaining([expect.objectContaining({ code: "empty-field" })]) });
    expect(llm.requests).toHaveLength(2);
  });
  it("handles malformed JSON values and model refusals without writing", async () => {
    const bad = encodeEdit(good[0]); bad.value_json = 'not json';
    const llm = new FakeLlmClient([{ json: { edits: [bad], notes: 'Oops' } }, { refusal: 'No' }]);
    expect(await proposeEditFix({ llm }, input)).toMatchObject({ ok: false, code: "no-fix" });
  });
  it("does not call a model for edits that add no errors", async () => {
    const llm = new FakeLlmClient([]);
    expect(await proposeEditFix({ llm }, { ...input, edits: good })).toMatchObject({ ok: false, code: "no-errors" });
    expect(llm.requests).toHaveLength(0);
  });
  it("the offline fixer drops only commands on affected entities", async () => {
    const unrelated: V3Edit = { type: "set", path: ["title"], value: "Keep this" };
    const result = await proposeEditFix({ llm: fakeEditFixer() }, { ...input, edits: [...broken, unrelated] });
    expect(result).toMatchObject({ ok: true, edits: [unrelated], notes: "I undid the changes that caused the errors." });
  });
  it("preserves teacher source policy operations outside the strict model vocabulary", async () => {
    const policy: V3Edit = { type: "sourcePolicy", value: { allowAny: true } };
    const result = await proposeEditFix({ llm: fakeEditFixer() }, { ...input, edits: [policy, ...broken] });
    expect(result).toMatchObject({ ok: true, edits: [policy] });
  });
  it("fixes skeleton edits through the same retry and validation boundary", async () => {
    const skeleton = goldenSkeleton(base);
    const edited = { ...skeleton, title: "" };
    const llm = new FakeLlmClient([reply([{ type: "set", path: ["title"], value: "A title" }])]);
    const result = await proposeSkeletonFix({ llm }, { base: skeleton, edited, issues: async raw => (raw as { title: string }).title ? [] : [{ code: "empty-field", path: "title", message: "Missing title" }] });
    expect(result).toMatchObject({ ok: true, skeleton: { title: "A title" } });
    expect(llm.requests[0].system).toContain('adventure plan (the skeleton)');
  });
  it("rejects document conversion and prototype paths in skeleton proposals", () => {
    const skeleton = goldenSkeleton(base);
    expect(() => applySkeletonEdits(skeleton, [{ type: "convertDocument", documentId: "x" }])).toThrow();
    expect(() => applySkeletonEdits(skeleton, [{ type: "set", path: ["__proto__", "polluted"], value: true }])).toThrow();
  });
  it("rejects invalid edits without throwing and identifies only newly introduced issues", () => {
    expect(checkTeacherEdits(base, [{ type: "unknown" }], [])).toMatchObject({ ok: false, errors: [{ code: "invalid-edit" }] });
    expect(checkTeacherEdits(base, good, [])).toMatchObject({ ok: true });
  });
});

describe("skeletonChanges", () => {
  it("round-trips entity removals, insertions, updates and reordered lists", () => {
    const skeleton = goldenSkeleton(base);
    const edited = structuredClone(skeleton);
    edited.characters = [{ ...edited.characters[2], name: "Changed" }, { ...edited.characters[0] }, { ...edited.characters[1], id: "new-person" }];
    edited.title = "New title";
    const changes = skeletonChanges(skeleton, edited);
    expect(changes.find(command => command.type === "remove")).toBeDefined();
    expect(changes.find(command => command.type === "insert")).toBeDefined();
    expect(applySkeletonEdits(skeleton, changes)).toEqual(edited);
  });
  it("emits no commands for an unchanged skeleton", () => {
    const skeleton = goldenSkeleton(base);
    expect(skeletonChanges(skeleton, structuredClone(skeleton))).toEqual([]);
  });
});
