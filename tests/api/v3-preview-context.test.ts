import { readFileSync } from "node:fs";
import { engine, previewInsight } from "@adventure/engine";
import { AdventureSpec } from "@adventure/spec-v3";
import { describe, expect, it } from "vitest";

import { previewContext, previewContextText } from "@/lib/v3/preview/context";

const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
const state = engine.createState(spec, "seed");
const view = engine.project(spec, state);
const insight = previewInsight(spec, state, 0);

describe("preview edit panel context", () => {
  it("shows a character's prompt text with editable fields and live stance", () => {
    const context = previewContext(spec, { kind: "character", id: "temenggong" }, insight, view)!;
    expect(context.title).toBe("Temenggong Abdul Rahman");
    expect(context.live[0]?.label).toBe("Current stance: wary");
    const voice = context.entries.find((entry) => entry.label === "Voice")!;
    expect(voice.lines[0]?.edit?.path).toEqual(["characters", 0, "persona", "voice"]);
    expect(context.live.every((entry) => entry.lines.every((line) => !line.edit))).toBe(true);
    const text = previewContextText(context);
    expect(text).toContain('character "Temenggong Abdul Rahman" (characters.0)');
    expect(text).toContain(spec.characters[0]!.persona.voice);
  });

  it("keeps a cleared field as an editable row and leaves it out of the chat context", () => {
    const cleared = structuredClone(spec);
    cleared.characters[0]!.persona.voice = "";
    const context = previewContext(cleared, { kind: "character", id: "temenggong" }, insight, view)!;
    const voice = context.entries.find((entry) => entry.label === "Voice")!;
    expect(voice.cleared).toBe(true);
    expect(voice.lines[0]?.edit).toEqual({ path: ["characters", 0, "persona", "voice"], value: "" });
    expect(previewContextText(context)).not.toContain("Voice:");
  });

  it("keeps source-bound document text and key passages read-only", () => {
    const index = spec.documents.findIndex((document) => document.keyPassages.length > 0);
    const document = spec.documents[index]!;
    const context = previewContext(spec, { kind: "document", id: document.id }, insight, view)!;
    expect(context.entries.find((entry) => entry.label === "Body")?.lines[0]?.edit).toBeUndefined();
    const passage = context.entries.find((entry) => entry.label === "Key passages")!.lines[0]!;
    expect(passage.text).toContain("Student's note:");
    expect(passage.edit).toBeUndefined();
    expect(context.entries.find((entry) => entry.label === "Title")?.lines[0]?.edit?.path).toEqual(["documents", index, "title"]);
  });

  it("falls back to the stage, the role and the reveal", () => {
    expect(previewContext(spec, { kind: "stage", index: 0 }, insight, view)?.title).toBe(spec.stages[0]!.title);
    expect(previewContext(spec, { kind: "role" }, insight, view)?.title).toBe(spec.role.name);
    expect(previewContext(spec, { kind: "reveal" }, insight, view)?.title).toBe("Reveal and questions");
    expect(previewContext(spec, { kind: "character", id: "missing" }, insight, view)).toBeNull();
  });
});
