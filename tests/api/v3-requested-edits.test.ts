import { describe, expect, it } from "vitest";
import { FakeLlmClient } from "@adventure/generation/llm";
import { proposeRequestedChanges } from "@/lib/v3/review-chat/propose";

const current = {
  stages: [{ id: "s-one", title: "The landing", narration: "A long scene." }],
  sources: [{ id: "source", title: "Evidence" }],
};
const answer = (path: string[], value: unknown) => ({
  json: {
    notes: "I shortened the scene.",
    changes: [{ path, value_json: JSON.stringify(value) }],
  },
});
const input = {
  text: "Shorten the first scene.",
  subject: "stages",
  current,
  roots: ["stages"],
  validate: async () => [],
};

describe("teacher-requested suggestions", () => {
  it("returns validated changes without modifying the current content", async () => {
    const llm = new FakeLlmClient([
      answer(["stages", "0", "narration"], "A short scene."),
    ]);
    expect(await proposeRequestedChanges({ llm }, input)).toMatchObject({
      ok: true,
      changes: [
        {
          type: "set",
          path: ["stages", 0, "narration"],
          value: "A short scene.",
        },
      ],
    });
    expect(current.stages[0].narration).toBe("A long scene.");
    expect(llm.requests[0].user).toContain(input.text);
    expect(llm.requests[0].system).not.toContain(input.text);
  });
  it.each([
    ["stages", "0", "id"],
    ["sources", "0", "title"],
    ["__proto__", "polluted"],
    ["stages", "0", "citations"],
  ])("refuses protected or out-of-scope paths %j", async (...path) => {
    const llm = new FakeLlmClient([
      answer(path, "Changed"),
      answer(path, "Changed"),
    ]);
    expect(await proposeRequestedChanges({ llm }, input)).toMatchObject({
      ok: false,
    });
  });
  it("retries validation failures and never offers an invalid correction", async () => {
    const llm = new FakeLlmClient([
      answer(["stages", "0", "title"], ""),
      answer(["stages", "0", "title"], "A title"),
    ]);
    const result = await proposeRequestedChanges(
      { llm },
      {
        ...input,
        validate: async (changes) =>
          changes[0].value === ""
            ? [
                {
                  code: "empty-field",
                  path: "stages.0.title",
                  message: "Missing title",
                },
              ]
            : [],
      },
    );
    expect(result).toMatchObject({ ok: true });
    expect(llm.requests[1].user).toContain("Missing title");
  });
  it("keeps marking keys and preparation requirements out of prose-only chat edits", async () => {
    const document = { readingCheck: { correctOptionId: "a", support: [{ start: 0, end: 50 }] } };
    for (const path of [["documents", "0", "readingCheck", "correctOptionId"], ["documents", "0", "readingCheck", "support", "0", "start"]]) {
      const llm = new FakeLlmClient([answer(path, path.at(-1) === "start" ? 1 : "b"), answer(path, path.at(-1) === "start" ? 1 : "b")]);
      expect(await proposeRequestedChanges({ llm }, { ...input, current: { documents: [document] }, roots: ["documents"] })).toMatchObject({ ok: false });
    }
  });
  it("includes recent exchanges so follow-up requests have context", async () => {
    const llm = new FakeLlmClient([
      answer(["stages", "0", "narration"], "Shorter."),
    ]);
    await proposeRequestedChanges(
      { llm },
      {
        ...input,
        text: "Shorter again, please.",
        history: [
          { role: "user", text: "Shorten the first stage's narration." },
        ],
      },
    );
    expect(llm.requests[0].user).toContain(
      "Shorten the first stage's narration.",
    );
    expect(llm.requests[0].system).toContain(
      "current content is authoritative",
    );
  });
  it("rejects empty requests before calling a model", async () => {
    const llm = new FakeLlmClient([]);
    expect(
      await proposeRequestedChanges({ llm }, { ...input, text: "   " }),
    ).toMatchObject({ ok: false });
    expect(llm.requests).toHaveLength(0);
  });
});
