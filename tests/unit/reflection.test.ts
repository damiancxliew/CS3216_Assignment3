import { describe, expect, it } from "vitest";

import {
  isReflectionComplete,
  REFLECTION_PROMPT_KEYS,
  resolveAnswer,
  scaffoldFor,
  STANCES,
  summarizeReflections,
  type ReflectionAnswer,
  type ReflectionDebrief,
  type ReflectionRow,
} from "@/lib/attempts/reflection";

const debrief = (overrides: Partial<ReflectionDebrief> = {}): ReflectionDebrief => ({
  path: [],
  documentedHistory: { citations: [] },
  collectedEvidence: [],
  ...overrides,
});

function answer(promptKey: ReflectionAnswer["promptKey"], overrides: Partial<ReflectionAnswer> = {}): ReflectionAnswer {
  return {
    promptKey,
    choice: null,
    choiceLabel: null,
    stance: null,
    response: "This is a sufficiently detailed historical judgement.",
    counter: null,
    ...overrides,
  };
}

describe("resolveAnswer", () => {
  it("rejects option ids not present in the debrief", () => {
    const result = resolveAnswer({
      promptKey: "evidence",
      choice: "not-an-evidence-id",
      response: "This is a sufficiently detailed historical judgement.",
    }, debrief({ collectedEvidence: [{ id: "source-1", name: "A dispatch" }] }));
    expect(result).toEqual({ ok: false, error: "Choose one of the listed options." });
  });

  it("uses the server option label instead of a client label", () => {
    const result = resolveAnswer({
      promptKey: "turning-point",
      choice: "2",
      choiceLabel: "A forged label",
      response: "This is a sufficiently detailed historical judgement.",
    }, debrief({ path: [{ stageIndex: 2, stageTitle: "The Treaty", chose: "Sign the accord" }] }));
    expect(result).toMatchObject({
      ok: true,
      answer: { choice: "2", choiceLabel: "Stage 1 · The Treaty: Sign the accord" },
    });
  });

  it("rejects a short response with the requested guidance", () => {
    const result = resolveAnswer({ promptKey: "factor", choice: "Trade", response: "Too short." }, debrief());
    expect(result).toEqual({ ok: false, error: "Write at least a sentence (20 characters)." });
  });

  it("requires a stance for inevitability", () => {
    const result = resolveAnswer({
      promptKey: "inevitability",
      response: "This is a sufficiently detailed historical judgement.",
    }, debrief());
    expect(result).toEqual({ ok: false, error: "Choose a judgement about the outcome." });
  });

  it("requires a factor choice and caps it at 60 characters", () => {
    const response = "This is a sufficiently detailed historical judgement.";
    expect(resolveAnswer({ promptKey: "factor", response }, debrief()).ok).toBe(false);
    expect(resolveAnswer({ promptKey: "factor", choice: "x".repeat(61), response }, debrief()).ok).toBe(false);
    expect(resolveAnswer({ promptKey: "factor", choice: "  Trade  ", response }, debrief())).toMatchObject({
      ok: true,
      answer: { choice: "Trade", choiceLabel: "Trade" },
    });
  });
});

describe("reflection completion", () => {
  it("does not require choices when no path or evidence options exist", () => {
    const answers = REFLECTION_PROMPT_KEYS.map((key) => answer(key, {
      stance: key === "inevitability" ? "open" : null,
      choice: key === "factor" ? "Trade" : null,
    }));
    expect(isReflectionComplete(answers, debrief())).toBe(true);
  });

  it("requires turning-point and evidence choices when their options exist", () => {
    const context = debrief({
      path: [{ stageIndex: 0, stageTitle: "The Landing", chose: "Wait" }],
      collectedEvidence: [{ id: "letter", name: "The letter" }],
    });
    const answers = REFLECTION_PROMPT_KEYS.map((key) => answer(key, {
      stance: key === "inevitability" ? "likely" : null,
      choice: key === "factor" ? "Trade" : null,
    }));
    expect(isReflectionComplete(answers, context)).toBe(false);
    answers[1] = answer("turning-point", { choice: "0" });
    answers[2] = answer("evidence", { choice: "letter" });
    expect(isReflectionComplete(answers, context)).toBe(true);
  });
});

describe("reflection scaffolding", () => {
  it("provides the expected starter and hint for every band", () => {
    const primary = scaffoldFor("factor", "primary");
    const lower = scaffoldFor("turning-point", "lower-secondary");
    const upper = scaffoldFor("evidence", "upper-secondary");
    const preUniversity = scaffoldFor("inevitability", "pre-university");

    expect(primary).toEqual({ starter: "I think ___ mattered most because the evidence shows ___.", hint: null, askCounter: false });
    expect(lower).toEqual({ starter: "This decision was the turning point because after it ___.", hint: null, askCounter: false });
    expect(upper).toEqual({
      starter: "Before reading this I thought ___. It changed my view because ___.",
      hint: "Point: make your claim. Evidence: give one detail from a scroll or source. Explain: show how that detail supports your claim.",
      askCounter: false,
    });
    expect(preUniversity).toEqual({
      starter: null,
      hint: "Weigh it against at least one alternative, and say why yours matters more.",
      askCounter: true,
    });
    expect(scaffoldFor("inevitability", "lower-secondary").starter).toBe("I think the outcome was ___ because ___.");
  });
});

describe("reflection summaries", () => {
  it("groups normalized factors, always includes all stances, and counts keywords by distinct attempt", () => {
    const rows: ReflectionRow[] = [
      { attempt_id: "a1", prompt_key: "factor", choice: "The British", choice_label: "The British", stance: null, response: "I think because the battle mattered greatly.", counter: null, updated_at: "2026-10-01T00:00:00Z" },
      { attempt_id: "a2", prompt_key: "factor", choice: "british", choice_label: "british", stance: null, response: "The battle changed the outcome significantly.", counter: null, updated_at: "2026-10-02T00:00:00Z" },
      { attempt_id: "a3", prompt_key: "factor", choice: "  British. ", choice_label: "British.", stance: null, response: "Their accounts make the battle important.", counter: null, updated_at: "2026-10-03T00:00:00Z" },
      { attempt_id: "a1", prompt_key: "inevitability", choice: null, choice_label: null, stance: "open", response: "The battle was not inevitable.", counter: "Someone could disagree.", updated_at: "2026-10-04T00:00:00Z" },
      { attempt_id: "a2", prompt_key: "inevitability", choice: null, choice_label: null, stance: "likely", response: "The battle was likely.", counter: null, updated_at: "2026-10-05T00:00:00Z" },
    ];
    const summary = summarizeReflections(rows);

    expect(summary.factors).toEqual([{ phrase: "The British", count: 3, attemptIds: ["a1", "a2", "a3"] }]);
    expect(summary.stances.map(({ stance }) => stance)).toEqual([...STANCES]);
    expect(summary.stances.map(({ count }) => count)).toEqual([0, 1, 1, 0]);
    expect(summary.keywords.find(({ word }) => word === "battle")).toEqual({ word: "battle", count: 3 });
    expect(summary.keywords.map(({ word }) => word)).not.toContain("because");
    expect(summary.keywords.map(({ word }) => word)).not.toContain("think");
    expect(summary.respondents).toBe(3);
  });
});
