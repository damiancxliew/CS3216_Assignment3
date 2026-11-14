import { describe, expect, it } from "vitest";
import { FakeDecisionClient } from "@adventure/generation/llm";
import {
  editableItems,
  isProtectedPath,
  pathLabel,
  textFields,
} from "@/lib/v3/review-chat/outline";
import { findEditTargets } from "@/lib/v3/review-chat/locate";

function adventure(overrides: Record<string, unknown> = {}) {
  return {
    title: "A harbour story",
    reveal: { whatHappened: "The ships waited for inspection." },
    stages: [
      { id: "stage-1", title: "Arrival", narration: "Ships came to port." },
      { id: "stage-2", title: "The dispute", narration: "The masters objected." },
      { id: "stage-3", title: "The hearing", narration: "The council listened." },
      { id: "stage-4", title: "The decision", narration: "The duties changed." },
    ],
    characters: [
      {
        id: "percival",
        name: "Arthur Percival",
        title: "Lieutenant-General, army commander",
        tier: "major",
        persona: { voice: "I have little strength left.", phrases: [] },
        stances: [{ id: "stance-1", label: "Strained", demeanour: "Tired" }],
      },
    ],
    documents: [
      {
        id: "register",
        title: "Port register",
        real: true,
        body: "The masters complained about the new duties.",
        sourceLabel: "Harbour records",
        citations: [{ sourceId: "source-1", quote: "The masters complained." }],
        keyPassages: [],
        readingCheck: {
          discoveryId: "discovery-1",
          variants: [],
          recovery: {
            id: "recovery",
            prompt: "What did the masters do?",
            options: [
              { id: "a", text: "They complained." },
              { id: "b", text: "They agreed." },
              { id: "c", text: "They left." },
            ],
            correctOptionId: "a",
            support: [{ start: 0, end: 27 }],
            explanation: "The register records complaints.",
          },
          recoveryDiscoveryIds: [],
        },
      },
    ],
    discoveries: [{ id: "discovery-1", title: "Complaints", text: "The masters objected." }],
    definingMoments: [{ id: "decision-1", title: "A decision", text: "The council changed the duties." }],
    endings: [{ id: "ending-1", title: "A settlement", text: "The parties reached a settlement." }],
    teacherQuestions: ["What does the register establish?"],
    ...overrides,
  };
}

function requestContent(request: { input: unknown }) {
  const input = request.input as {
    role: string;
    content: { type: string; data?: unknown; text?: string }[];
  }[];
  return input[0]!.content;
}

describe("review-chat target outline", () => {
  it("covers editable item groups and prefers a character's name to their role", () => {
    const items = editableItems(adventure());
    const keys = items.map(({ key }) => key);

    expect(keys).toEqual(expect.arrayContaining([
      "title",
      "reveal",
      "stages.0",
      "characters.0",
      "documents.0",
      "discoveries.0",
      "definingMoments.0",
      "endings.0",
      "teacherQuestions.0",
    ]));
    expect(items.find(({ key }) => key === "characters.0")?.label).toBe("Arthur Percival");
    expect(items.find(({ key }) => key === "characters.0")?.preview).toContain("I have little strength left.");
  });

  it("excludes protected leaves and returns real document bodies as locked fields", () => {
    const spec = adventure();
    const documentFields = textFields(spec, ["documents", 0]);
    const paths = documentFields.map(({ path }) => path.join("."));

    expect(isProtectedPath(["documents", 0, "readingCheck", "recovery", "correctOptionId"])).toBe(true);
    expect(paths).not.toContain("documents.0.id");
    expect(paths).not.toContain("documents.0.sourceLabel");
    expect(paths).not.toContain("documents.0.citations.0.quote");
    expect(paths).not.toContain("documents.0.readingCheck.recovery.correctOptionId");
    expect(documentFields.find(({ path }) => path.join(".") === "documents.0.body")).toMatchObject({
      text: "The masters complained about the new duties.",
      locked: "Quoted from your source — chat can't rewrite it.",
    });
  });

  it("excludes enum fields while retaining prose and merges indexed path labels", () => {
    const fields = textFields(adventure(), ["characters", 0]);
    const labels = fields.map(({ label }) => label);

    expect(fields.map(({ path }) => path.join("."))).toContain(
      "characters.0.persona.voice",
    );
    expect(fields.map(({ path }) => path.join("."))).not.toContain(
      "characters.0.tier",
    );
    expect(labels).toContain("Arthur Percival · Stance 1 · Demeanour");
    expect(
      pathLabel(["definingMoments", 0, "acts", 1, "reaction"]),
    ).toBe("Decision 1 · Act 2 · Reaction");
  });
});

describe("review-chat target discovery", () => {
  it("selects the top three items and returns likely and maybe fields in item order", async () => {
    const client = new FakeDecisionClient([
      { i0: 0.95, i1: 0.9, i2: 0.8, i3: 0.7, i4: 0.4, i5: 0.2 },
      { f0: 0.6, f1: 0.4, f2: 0.8, f3: 0.9, f4: 0.3, f5: 0.1, f6: 0.51 },
    ]);
    const text = "Make the first scene shorter";
    const result = await findEditTargets({ decide: client }, { spec: adventure(), text });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]!.questions.map(({ name }) => name)).toEqual(
      editableItems(adventure()).map((_, index) => `i${index}`),
    );
    expect((requestContent(client.requests[1]!)[0]!.data as { fields: unknown[] }).fields.length).toBeGreaterThan(0);
    expect(result.targets.map(({ path }) => path[0])).not.toContain("endings");
    expect(result.targets.some(({ selected }) => !selected)).toBe(true);
    expect(result.targets.filter(({ selected }) => selected).length).toBeGreaterThan(0);
  });

  it("falls back to the top item and field at the lower thresholds", async () => {
    const client = new FakeDecisionClient([
      { i0: 0.4, i1: 0.29 },
      { f0: 0.2, f1: 0.1 },
    ]);
    const result = await findEditTargets({ decide: client }, { spec: adventure(), text: "Change the title" });

    expect(result).toMatchObject({
      ok: true,
      targets: [{ score: 0.2, selected: true }],
    });
    expect(client.requests[1]!.questions.length).toBeGreaterThan(0);
  });

  it("returns the exact guidance when no item is probable enough", async () => {
    const client = new FakeDecisionClient([{ i0: 0.29, i1: 0.1 }]);

    expect(await findEditTargets(
      { decide: client },
      { spec: { title: "A story" }, text: "Change something" },
    )).toEqual({
      ok: false,
      message: "I couldn't tell which part to change. Mark a field with the target icon, then send again.",
    });
    expect(client.requests).toHaveLength(1);
  });

  it("keeps the outline before the request and never puts teacher text in question instructions", async () => {
    const client = new FakeDecisionClient([
      { i0: 0.9, i1: 0.8 },
      { f0: 0.7 },
    ]);
    const text = "Rewrite ONLY this field";
    await findEditTargets({ decide: client }, { spec: adventure(), text });

    for (const request of client.requests) {
      const content = requestContent(request);
      expect(content[0]).toMatchObject({ type: "input_json" });
      expect(content[1]).toEqual({
        type: "input_text",
        text: `Teacher's edit request: ${text}`,
      });
      expect(request.questions.every(({ instructions }) => !instructions.includes(text))).toBe(true);
    }
  });

  it("caps the field pass at 400 questions while keeping the first item fields", async () => {
    const fields = Object.fromEntries(Array.from({ length: 401 }, (_, index) => [`field${index}`, `Value ${index}`]));
    const spec = { title: "A large story", stages: [{ id: "stage-1", ...fields }] };
    const client = new FakeDecisionClient((request) =>
      Object.fromEntries(request.questions.map(({ name }) => [
        name,
        name.startsWith("i") ? 0.9 : 0.4,
      ])),
    );
    const result = await findEditTargets({ decide: client }, { spec, text: "Change a field" });

    expect(result.ok).toBe(true);
    expect(client.requests[1]!.questions).toHaveLength(400);
    expect(requestContent(client.requests[1]!)[0]!.data).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ key: "stages.0.field0" }),
      ]),
    });
  });
});
