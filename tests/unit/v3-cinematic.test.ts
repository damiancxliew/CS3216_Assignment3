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
      { id: "knows", kicker: "What you already know", items: ["Raffles is in a hurry."], more: true },
      { id: "relationships", kicker: "People you know", items: ["You have worked with Farquhar."], more: true },
    ]);
  });

  it("builds at most two beats: what happened (or narration) and the question", () => {
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
      { id: "what-happened", kicker: "What happened", body: "The talks continued.", items: ["You predicted: The talks would be delayed.", "Why: Both parties returned to the table."] },
      { id: "question", kicker: "The question", body: "Whose authority will the agreement recognize?" },
    ]);
  });

  it("uses narration when there is no prediction and never adds a preparation beat", () => {
    const stage = { index: 0, count: 2, title: "T", timePlace: "P", centralQuestion: "Q?", intro: { narration: "Meanwhile text.", predictionReveal: null }, preparation: { essentialConversations: [{ name: "Ann" }] } } as unknown as StageView;
    expect(stageIntroBeats(stage).map((beat) => beat.id)).toEqual(["narration", "question"]);
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

    expect(stageIntroBeats(stage)[0]?.items).toEqual([
      "You predicted: He will sign, and send for Tengku Hussein.",
      "Why: He did not yet trust the British, and feared what Riau would do.",
    ]);
  });
});

describe("concise brief helpers", () => {
  it("derives the big question from the role's stakes, keeping a short question with its lead-in", async () => {
    const { bigQuestion } = await import("@/lib/play/v3/cinematic");
    expect(bigQuestion({ stakes: "Singapore is called an impregnable fortress. Is it? You can't give orders." })).toBe("Singapore is called an impregnable fortress. Is it?");
    expect(bigQuestion({ stakes: "What will become of the island once the British arrive in force?" })).toBe("What will become of the island once the British arrive in force?");
    expect(bigQuestion({ stakes: "Your work in Malacca is gone." }, { centralQuestion: "Who will shape the island?" })).toBe("Who will shape the island?");
    expect(bigQuestion({ stakes: "No question here." })).toBeNull();
  });

  it("keeps two real sentences on screen and lets a dateline ride along", async () => {
    const { briefExcerpt } = await import("@/lib/play/v3/cinematic");
    expect(briefExcerpt('February 1942. The army is back on the island. The enemy is across the strait. A notice says "Singapore is a fortress."')).toEqual({
      lead: "February 1942. The army is back on the island. The enemy is across the strait.",
      rest: 'A notice says "Singapore is a fortress."',
    });
    expect(briefExcerpt("One short line only.")).toEqual({ lead: "One short line only.", rest: "" });
  });

  it("finds where and when, and splits a fictional marker off the position", async () => {
    const { roleWhenWhere, splitFictional } = await import("@/lib/play/v3/cinematic");
    expect(roleWhenWhere({ situation: "February 1942. Singapore is a British colony." })).toBe("February 1942");
    expect(roleWhenWhere({ situation: "Ships have anchored at the river mouth." })).toBeNull();
    expect(roleWhenWhere({ situation: "February 1942." }, { timePlace: "Fort Canning, early February 1942" })).toBe("Fort Canning, early February 1942");
    expect(splitFictional("Junior liaison officer at army headquarters (fictional)")).toEqual({ position: "Junior liaison officer at army headquarters", fictional: true });
    expect(splitFictional("Clerk to Stamford Raffles")).toEqual({ position: "Clerk to Stamford Raffles", fictional: false });
  });
});
