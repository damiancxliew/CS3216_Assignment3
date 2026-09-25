import { describe, expect, it } from "vitest";

import { cutsceneBackdrop, cutsceneBeats } from "@/lib/play/cutscene";
import type { PlayState } from "@/lib/play/session";

function state(overrides: Partial<PlayState> = {}): PlayState {
  return {
    stageCount: 3,
    decisionPrompt: "Do you sign the treaty?",
    player: { name: "Amina", role: "Harbour clerk", brief: "You keep the cargo ledgers." },
    stage: {
      id: "stage-2",
      index: 1,
      title: "The quay at dawn",
      setting: "Aden, 1839",
      sharedContext: "Two crews claim the same cargo.",
      objectives: [
        { id: "a", title: "Read the manifest", met: true },
        { id: "b", title: "Hear both crews", met: false },
      ],
    },
    landmarks: [{ id: "l1", imageUrl: "https://example.test/quay.png" }],
    ...overrides,
  } as unknown as PlayState;
}

describe("stage cutscene", () => {
  it("opens on the setting and closes on the dilemma", () => {
    const beats = cutsceneBeats(state());
    expect(beats.map((beat) => beat.id)).toEqual(["place", "situation", "role", "goals", "decision"]);
    expect(beats[0]).toMatchObject({ kicker: "Stage 2 of 3", title: "The quay at dawn", body: "Aden, 1839" });
    expect(beats.at(-1)!.body).toBe("Do you sign the treaty?");
  });

  it("lists only the goals still open, and drops the beat when there are none", () => {
    expect(cutsceneBeats(state()).find((beat) => beat.id === "goals")!.items).toEqual(["Hear both crews"]);
    const done = state({ stage: { ...state().stage, objectives: [{ id: "a", title: "Read the manifest", met: true }] } as PlayState["stage"] });
    expect(cutsceneBeats(done).some((beat) => beat.id === "goals")).toBe(false);
  });

  it("uses generated stage art as the backdrop when there is some", () => {
    expect(cutsceneBackdrop(state())).toBe("https://example.test/quay.png");
    expect(cutsceneBackdrop(state({ landmarks: [] }))).toBeNull();
  });
});
