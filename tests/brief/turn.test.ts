/**
 * The brief conversation asks its questions in a fixed order, parses the
 * simple answers itself, and only consults the model for objectives and
 * stages — where it still decides when a slot counts as filled. No database,
 * no network: a scripted `FakeLlmClient` stands in for the model.
 */
import { FakeLlmClient } from "@adventure/generation/llm";
import { describe, expect, it } from "vitest";

import { completeBrief, currentSlot, initialBriefState, quickReplies, type BriefState } from "@/lib/brief/schema";
import { runBriefTurn } from "@/lib/brief/turn";

const ADVENTURE_ID = "00000000-0000-4000-8000-000000000001";
const DIGEST = { summary: "A local test source.", title: "A Post at the River Mouth", setting: "Singapore and Johor, February 1819", studentRole: "Junior interpreter to the expedition" };
const none = () => new FakeLlmClient([]);
const defaultLlm = () => new FakeLlmClient([{ json: { reply: "What should students learn?", objectives: [], complete: false } }]);

function afterSources(): BriefState {
  return {
    ...initialBriefState(ADVENTURE_ID),
    draft: { sources: DIGEST },
    messages: [{ role: "assistant", text: "What should the adventure be called?", slot: "title", proposedText: DIGEST.title }],
  };
}

async function say(state: BriefState, text: string, llm = defaultLlm()): Promise<BriefState> {
  const result = await runBriefTurn(state, { text }, llm, []);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function lastText(state: BriefState): string {
  return state.messages.at(-1)!.text;
}

/** Answers everything up to the learning objectives, which need the model. */
async function throughRole(): Promise<BriefState> {
  let state = afterSources();
  state = await say(state, "A Post at the River Mouth");
  state = await say(state, "Singapore and Johor, February 1819");
  return say(state, "Junior interpreter to the expedition");
}

describe("scripted slots", () => {
  it("requires an uploaded source before the title", async () => {
    const llm = none();
    const result = await runBriefTurn(initialBriefState(ADVENTURE_ID), { text: "Done" }, llm, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(currentSlot(result.state.draft)).toEqual({ name: "sources" });
      expect(lastText(result.state)).toMatch(/upload|paste/i);
    }
    expect(llm.requests).toHaveLength(0);
  });

  it("opens with the title and walks the fixed order", async () => {
    let state = afterSources();
    expect(currentSlot(state.draft)).toEqual({ name: "title" });
    expect(lastText(state)).toMatch(/called/);

    state = await say(state, "A Post at the River Mouth");
    expect(currentSlot(state.draft)).toEqual({ name: "setting" });
    state = await say(state, "Singapore and Johor, February 1819");
    expect(currentSlot(state.draft)).toEqual({ name: "studentRole" });
    state = await say(state, "Junior interpreter to the expedition");
    expect(currentSlot(state.draft)).toEqual({ name: "learningObjectives" });
    expect(state.draft).toMatchObject({
      title: "A Post at the River Mouth",
      setting: "Singapore and Johor, February 1819",
      studentRole: "Junior interpreter to the expedition",
    });
  });

  it("re-asks with a reason instead of accepting a bad answer", async () => {
    let state = afterSources();
    const result = await runBriefTurn(state, { text: "   " }, none(), []);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/answer/) });

    state = await say(state, "x".repeat(121));
    expect(currentSlot(state.draft)).toEqual({ name: "title" });
    expect(lastText(state)).toMatch(/120 characters/);
  });

  it("parses reading band labels, age ranges and stage counts", async () => {
    let state: BriefState = {
      adventureId: ADVENTURE_ID,
      draft: { sources: DIGEST, title: "t", setting: "s", studentRole: "r", learningObjectives: ["Explain x"] },
      messages: [],
      sources: [],
    };
    expect(currentSlot(state.draft)).toEqual({ name: "band" });
    expect(quickReplies(state.draft, { name: "band" })).toContain("Lower secondary");

    state = await say(state, "somewhere in the middle");
    expect(currentSlot(state.draft)).toEqual({ name: "band" });
    expect(lastText(state)).toMatch(/Choose one of/);

    state = await say(state, "Lower secondary");
    expect(state.draft.band).toBe("lower-secondary");
    expect(quickReplies(state.draft, { name: "ages" })).toEqual(["13 to 14"]);

    state = await say(state, "14 to 13");
    expect(lastText(state)).toMatch(/upside down/);
    state = await say(state, "ages 13–14");
    expect(state.draft.ages).toEqual({ ageMin: 13, ageMax: 14 });

    state = await say(state, "five");
    expect(lastText(state)).toMatch(/1, 2 or 3/);
  });
});

describe("model-assisted slots", () => {
  it("fills the objectives when the model says the answer is complete", async () => {
    const llm = new FakeLlmClient([
      { json: { reply: "Two objectives it is.", objectives: ["Explain why the EIC wanted a port at the Straits", "Describe the Johor succession dispute"], complete: true } },
    ]);
    let state = await throughRole();
    state = await say(state, "why the EIC wanted a port, and the Johor succession mess", llm);

    expect(state.draft.learningObjectives).toHaveLength(2);
    expect(currentSlot(state.draft)).toEqual({ name: "band" });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.system).not.toContain("Singapore");
    expect(llm.requests[0]!.user).toContain("Teacher: why the EIC wanted a port");
  });

  it("keeps asking when the answer is vague, and lets the teacher accept the draft", async () => {
    const llm = new FakeLlmClient([
      { json: { reply: "Here are two — keep both?", objectives: ["Explain A", "Describe B"], complete: false } },
    ]);
    let state = await throughRole();
    state = await say(state, "the founding of Singapore", llm);
    expect(currentSlot(state.draft)).toEqual({ name: "learningObjectives" });
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", proposedObjectives: ["Explain A", "Describe B"] });

    const accepted = await runBriefTurn(state, { accept: true }, none(), []);
    expect(accepted.ok && accepted.state.draft.learningObjectives).toEqual(["Explain A", "Describe B"]);
  });

  it("opens each stage with a model-written question and never fills a stage from the opener", async () => {
    const llm = new FakeLlmClient([
      // Opening stage 1: `complete` is meaningless here and must be ignored.
      { json: { reply: "Stage 1 could be the landing. Use it?", stage: { title: "The Landing", focus: "Decide whom to greet first." }, complete: true } },
      // Teacher's answer to stage 1.
      { json: { reply: "Got it.", stage: { title: "The Landing", focus: "Decide whether to trust the Temenggong." }, complete: true } },
      // Opening stage 2.
      { json: { reply: "Stage 2: the succession. What should the student decide?", stage: null, complete: false } },
    ]);
    let state: BriefState = {
      adventureId: ADVENTURE_ID,
      draft: { sources: DIGEST, title: "t", setting: "s", studentRole: "r", learningObjectives: ["Explain x"], band: "lower-secondary", ages: { ageMin: 13, ageMax: 14 } },
      messages: [],
      sources: [],
    };
    state = await say(state, "2", llm);
    expect(state.draft.stageCount).toBe(2);
    expect(currentSlot(state.draft)).toEqual({ name: "stage", index: 0 });
    expect(state.messages.at(-1)).toMatchObject({ slot: "stage:0", proposal: { title: "The Landing" } });
    expect(llm.requests[0]!.system).toContain("stage 1 of 2");

    state = await say(state, "the landing, but about trusting the Temenggong", llm);
    expect(state.draft.stageOutline?.[0]).toEqual({ title: "The Landing", focus: "Decide whether to trust the Temenggong." });
    expect(currentSlot(state.draft)).toEqual({ name: "stage", index: 1 });
    expect(llm.requests[2]!.system).toContain("the final stage, 2 of 2");
    expect(llm.requests[2]!.user).toContain("1. The Landing — Decide whether to trust the Temenggong.");
    expect(state.messages.at(-1)!.proposal).toBeUndefined();
  });

  it("reports the model being unavailable without corrupting the state", async () => {
    const state = await throughRole();
    const result = await runBriefTurn(state, { text: "anything" }, new FakeLlmClient([{ error: "boom" }]), []);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/couldn’t answer/) });
  });
});

describe("summary and changes", () => {
  const filled: BriefState = {
    adventureId: ADVENTURE_ID,
    draft: {
      sources: DIGEST,
      title: "t",
      setting: "s",
      studentRole: "r",
      learningObjectives: ["Explain x"],
      band: "lower-secondary",
      ages: { ageMin: 13, ageMax: 14 },
      stageCount: 1,
      stageOutline: [{ title: "Only", focus: "Decide." }],
    },
    messages: [],
    sources: [],
  };

  it("is complete once every slot is filled", () => {
    expect(currentSlot(filled.draft)).toEqual({ name: "confirm" });
    expect(completeBrief(filled.draft)).toEqual({
      title: "t",
      setting: "s",
      studentRole: "r",
      learningObjectives: ["Explain x"],
      readingLevel: { band: "lower-secondary", ageMin: 13, ageMax: 14 },
      stageOutline: [{ title: "Only", focus: "Decide." }],
    });
    expect(completeBrief({ ...filled.draft, stageOutline: [null] })).toBeNull();
  });

  it("reopens one slot from the summary and returns to it afterwards", async () => {
    const result = await runBriefTurn(filled, { change: "setting" }, none(), []);
    expect(result.ok && currentSlot(result.state.draft)).toEqual({ name: "setting" });
    expect(result.ok && result.state.draft.title).toBe("t");

    const back = await say(result.ok ? result.state : filled, "Malacca, 1511");
    expect(currentSlot(back.draft)).toEqual({ name: "confirm" });
    expect(back.draft.setting).toBe("Malacca, 1511");
  });

  it("changing the stage count discards the stage plan", async () => {
    const result = await runBriefTurn(filled, { change: "stageCount" }, none(), []);
    expect(result.ok && result.state.draft.stageOutline).toBeUndefined();
    expect(result.ok && currentSlot(result.state.draft)).toEqual({ name: "stageCount" });
  });

  it("refuses free text at the summary", async () => {
    const result = await runBriefTurn(filled, { text: "hello" }, none(), []);
    expect(result.ok).toBe(false);
  });
});
