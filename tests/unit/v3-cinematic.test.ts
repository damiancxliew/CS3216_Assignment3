import { describe, expect, it } from "vitest";

import { briefingBeats, stageIntroBeats } from "@/lib/play/v3/cinematic";
import type { RoleBriefingView, StageView } from "@adventure/play-contract";

describe("V3 cinematic beats", () => {
  it("builds a role briefing without empty beats", () => {
    const briefing: RoleBriefingView = {
      name: "Ahmad",
      position: "A Malay interpreter",
      relationships: ["You have worked with Farquhar."],
      reputation: "Both sides trust you a little.",
      stakes: "Your work in Malacca is gone.",
      privateBrief: {
        goals: ["See a post founded."],
        fears: [],
        constraints: ["You cannot promise in your own name."],
        knows: ["Raffles is in a hurry."],
      },
      situation: "Ships have anchored at the river mouth.",
    };
    const firstStage = {
      index: 0,
      count: 2,
      title: "The landing",
      timePlace: "Singapore River, 1819",
      centralQuestion: "Who will shape the island?",
      intro: null,
    } satisfies StageView;

    expect(briefingBeats(briefing, firstStage)).toEqual([
      { id: "role", kicker: "Your role", title: "Ahmad", body: "A Malay interpreter", items: ["At Singapore River, 1819"] },
      { id: "situation", kicker: "The situation", body: "Ships have anchored at the river mouth." },
      { id: "stakes", kicker: "What is at stake", body: "Your work in Malacca is gone.", items: ["Your reputation: Both sides trust you a little."] },
      { id: "goals", kicker: "Your goals", items: ["See a post founded."] },
      { id: "knows", kicker: "What you already know", items: ["Raffles is in a hurry."] },
      { id: "relationships", kicker: "People you know", items: ["You have worked with Farquhar."] },
    ]);
  });

  it("builds stage place, prediction reveal, narration, and question beats", () => {
    const stage: StageView = {
      index: 1,
      count: 3,
      title: "The agreement",
      timePlace: "Singapore, February 1819",
      centralQuestion: "Whose authority will the agreement recognize?",
      intro: {
        narration: "The party returns to the river.",
        predictionReveal: {
          predicted: "The talks would be delayed.",
          actual: "The talks continued.",
          because: "Both parties returned to the table.",
        },
      },
    };

    expect(stageIntroBeats(stage)).toEqual([
      { id: "place", kicker: "Stage 2 of 3", title: "The agreement", body: "Singapore, February 1819" },
      { id: "what-happened", kicker: "What happened", body: "The talks continued.", items: ["You predicted: The talks would be delayed.", "Why: Both parties returned to the table."] },
      { id: "narration", kicker: "Meanwhile", body: "The party returns to the river." },
      { id: "question", kicker: "The question", body: "Whose authority will the agreement recognize?" },
    ]);
  });

  it("turns a generated reason fragment into a sentence", () => {
    const stage = {
      index: 1,
      count: 2,
      title: "The disputed throne",
      timePlace: "Singapore, February 1819",
      centralQuestion: "Whose authority will make the treaty lawful?",
      intro: {
        narration: "",
        predictionReveal: {
          predicted: "he will sign, and send for Tengku Hussein",
          actual: "The Temenggong would not sign, and sent to Riau for word.",
          because: "he did not yet trust the British, and feared what Riau would do",
        },
      },
    } satisfies StageView;

    expect(stageIntroBeats(stage)[1]?.items).toEqual([
      "You predicted: He will sign, and send for Tengku Hussein.",
      "Why: He did not yet trust the British, and feared what Riau would do.",
    ]);
  });
});
