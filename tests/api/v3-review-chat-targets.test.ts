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
  it("selects the top three items and returns only selected fields in item order", async () => {
    const client = new FakeDecisionClient([
      { change: 1 },
      { i0: 0.95, i1: 0.9, i2: 0.8, i3: 0.7, i4: 0.4, i5: 0.2 },
      { f0: 0.6, f1: 0.4, f2: 0.8, f3: 0.9, f4: 0.3, f5: 0.1, f6: 0.51 },
    ]);
    const text = "Make the first scene shorter";
    const result = await findEditTargets({ decide: client }, { spec: adventure(), text });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toBe("change");
    expect(client.requests).toHaveLength(3);
    expect(client.requests[0]!.questions.map(({ name }) => name)).toEqual(["change"]);
    expect(requestContent(client.requests[0]!)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "input_json" })]),
    );
    expect(client.requests[1]!.questions.map(({ name }) => name)).toEqual(
      editableItems(adventure()).map((_, index) => `i${index}`),
    );
    expect((requestContent(client.requests[2]!)[0]!.data as { fields: unknown[] }).fields.length).toBeGreaterThan(0);
    expect(result.targets.map(({ path }) => path[0])).not.toContain("endings");
    expect(result.targets.every(({ selected, score }) => selected && score >= 0.5)).toBe(true);
  });

  it("returns reply intent without a field pass when change intent is below threshold", async () => {
    const client = new FakeDecisionClient([{ change: 0.49 }]);
    const result = await findEditTargets({ decide: client }, { spec: adventure(), text: "Change the title" });

    expect(result).toEqual({ ok: true, intent: "reply" });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.questions.map(({ name }) => name)).toEqual(["change"]);
    expect(requestContent(client.requests[0]!)).toEqual([
      { type: "input_text", text: "Teacher's message: Change the title" },
    ]);
  });

  it("does not use a low-confidence item fallback", async () => {
    const client = new FakeDecisionClient([{ change: 1 }, { i0: 0.49, i1: 0.3 }]);

    expect(await findEditTargets(
      { decide: client },
      { spec: { title: "A story" }, text: "Change something" },
    )).toEqual({
      ok: false,
      message: "I couldn't tell which part to change. Name the stage, character or document, or mark a field with its target button.",
    });
    expect(client.requests).toHaveLength(2);
  });

  it("force-selects only the top field when none reaches 0.5", async () => {
    const client = new FakeDecisionClient([
      { change: 1 },
      { i0: 0.9 },
      { f0: 0.49, f1: 0.2 },
    ]);
    const result = await findEditTargets({ decide: client }, { spec: { title: "A story" }, text: "Change the title" });

    expect(result).toMatchObject({
      ok: true,
      intent: "change",
      targets: [{ score: 0.49, selected: true }],
    });
  });

  it("keeps the outline before the request and never puts teacher text in question instructions", async () => {
    const client = new FakeDecisionClient([
      { change: 1 },
      { i0: 0.9, i1: 0.8 },
      { f0: 0.7 },
    ]);
    const text = "Rewrite ONLY this field";
    await findEditTargets({ decide: client }, { spec: adventure(), text });

    expect(requestContent(client.requests[0]!)).toEqual([
      { type: "input_text", text: `Teacher's message: ${text}` },
    ]);
    expect(client.requests[0]!.questions).toEqual([{
      name: "change",
      instructions: "A teacher is chatting about their history adventure. Does the teacher's message ask for the adventure's saved content to be changed? Answer yes for requests, instructions or complaints about the content (including conditional ones like \"if so, trim it\", and statements that something is too long, too hard or sounds wrong). Answer no for questions, requests for an opinion, a summary or an explanation in chat, thanks, approval, or other comments that do not ask for a change.",
    }]);
    expect(requestContent(client.requests[1]!)).toEqual([
      expect.objectContaining({ type: "input_json" }),
      { type: "input_text", text: `Teacher's message: ${text}` },
    ]);
    expect(client.requests[1]!.questions[0]).toEqual({
      name: "i0",
      instructions: 'Is the teacher asking for the text of item "title" (Adventure title) to be changed? A question, opinion request, summary request or thanks is not a request to change it.',
    });
    expect(requestContent(client.requests[2]!)[1]).toEqual({
      type: "input_text",
      text: `Teacher's edit request: ${text}`,
    });
    expect(client.requests.flatMap(({ questions }) => questions).every(
      ({ instructions }) => !instructions.includes(text),
    )).toBe(true);
  });

  it("describes collection items by kind and one-based ordinal in Decisions", async () => {
    const spec = adventure({
      discoveries: [{ id: "discovery-3", title: "Discovery 3: Original title", text: "An account." }],
    });
    const client = new FakeDecisionClient([{ change: 1 }, { i0: 0 }]);
    await findEditTargets({ decide: client }, { spec, text: "Is this clear?" });

    const content = requestContent(client.requests[1]!);
    const outline = (content[0]!.data as {
      outline: { key: string; label: string }[];
    }).outline;
    expect(outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "title", label: "Adventure title" }),
      expect.objectContaining({ key: "stages.0", label: "Stage 1: Arrival" }),
      expect.objectContaining({ key: "characters.0", label: "Character 1: Arthur Percival" }),
      expect.objectContaining({ key: "documents.0", label: "Document 1: Port register" }),
      expect.objectContaining({ key: "discoveries.0", label: "Discovery 3: Original title" }),
      expect.objectContaining({ key: "definingMoments.0", label: "Decision 1: A decision" }),
      expect.objectContaining({ key: "endings.0", label: "Ending 1: A settlement" }),
      expect.objectContaining({ key: "teacherQuestions.0", label: "Discussion question 1" }),
    ]));
    const stageIndex = outline.findIndex(({ key }) => key === "stages.0");
    expect(client.requests[1]!.questions[stageIndex]).toEqual({
      name: `i${stageIndex}`,
      instructions: 'Is the teacher asking for the text of item "stages.0" (Stage 1: Arrival) to be changed? A question, opinion request, summary request or thanks is not a request to change it.',
    });
  });

  it("caps the field pass at 400 questions while keeping the first item fields", async () => {
    const fields = Object.fromEntries(Array.from({ length: 401 }, (_, index) => [`field${index}`, `Value ${index}`]));
    const spec = { title: "A large story", stages: [{ id: "stage-1", ...fields }] };
    const client = new FakeDecisionClient((request) =>
      Object.fromEntries(request.questions.map(({ name }) => [
        name,
        name === "change" ? 1 : name.startsWith("i") ? 0.9 : 0.4,
      ])),
    );
    const result = await findEditTargets({ decide: client }, { spec, text: "Change a field" });

    expect(result.ok).toBe(true);
    expect(client.requests[2]!.questions).toHaveLength(400);
    expect(requestContent(client.requests[2]!)[0]!.data).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ key: "stages.0.field0" }),
      ]),
    });
  });

  it("keeps the item pass under the 400-question cap", async () => {
    const stages = Array.from({ length: 401 }, (_, index) => ({
      id: `stage-${index}`,
      title: `Stage ${index}`,
      narration: `Narration ${index}`,
    }));
    const client = new FakeDecisionClient((request) =>
      Object.fromEntries(request.questions.map(({ name }) => [
        name,
        name === "change" ? 1 : 0.9,
      ])),
    );
    await findEditTargets({ decide: client }, {
      spec: { title: "A large story", stages },
      text: "Change the first scene",
    });

    expect(client.requests[1]!.questions).toHaveLength(400);
  });

  it("includes recent conversation before the message in intent and item requests", async () => {
    const client = new FakeDecisionClient([{ change: 1 }, {}]);
    const history = [
      { role: "user" as const, text: "What does the document say?" },
      { role: "assistant" as const, text: "It says the Company may trade." },
    ];
    await findEditTargets(
      { decide: client },
      { spec: adventure(), text: "Yes, do that.", history },
    );

    const historyText =
      "Earlier conversation:\nTeacher: What does the document say?\nAssistant: It says the Company may trade.";
    expect(requestContent(client.requests[0]!)).toEqual([
      { type: "input_text", text: historyText },
      { type: "input_text", text: "Teacher's message: Yes, do that." },
    ]);
    expect(requestContent(client.requests[0]!)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "input_json" })]),
    );
    expect(requestContent(client.requests[1]!)).toEqual([
      expect.objectContaining({ type: "input_json" }),
      { type: "input_text", text: historyText },
      { type: "input_text", text: "Teacher's message: Yes, do that." },
    ]);
    expect(client.requests[1]!.questions.some(({ name }) => name === "change")).toBe(false);
  });
});
