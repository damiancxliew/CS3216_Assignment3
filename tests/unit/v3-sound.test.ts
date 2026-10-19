import { describe, expect, it } from "vitest";
import type { PlayerView } from "@adventure/play-contract";

import { v3CuesBetween } from "@/components/play/v3/v3-sound";

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: "stage",
    briefing: { name: "Role", position: "", relationships: [], reputation: "", stakes: "", privateBrief: { goals: [], fears: [], constraints: [], knows: [] }, situation: "" },
    stage: { index: 0, count: 2, title: "Stage", timePlace: "Place", centralQuestion: "Question", intro: null },
    rooms: [],
    currentRoomId: null,
    characters: [],
    speakers: [],
    messages: [],
    notes: [],
    documents: [],
    documentsHere: [],
    definingMoment: null,
    timer: null,
    pendingCheck: false,
    epilogue: null,
    interview: null,
    reveal: null,
    ended: false,
    ...overrides,
  };
}

describe("v3CuesBetween", () => {
  it("emits evidence, character, and narration cues with stable unique stage/count keys", () => {
    const before = view();
    const after = view({
      notes: [{ id: "note-1", text: "A fact", source: "conversation", stageIndex: 0, at: "2026-10-19T00:00:00.000Z" }],
      messages: [
        { id: "m1", kind: "character", characterId: "c1", roomId: "r1", text: "Hello", insertedNoteId: null, stageIndex: 0, at: "2026-10-19T00:00:00.000Z" },
        { id: "m2", kind: "narration", characterId: null, roomId: null, text: "The room settles.", insertedNoteId: null, stageIndex: 0, at: "2026-10-19T00:00:01.000Z" },
      ],
    });
    const cues = v3CuesBetween(before, after);

    expect(cues.map(({ id }) => id)).toEqual(["evidence", "accept", "resolution"]);
    expect(new Set(cues.map(({ key }) => key)).size).toBe(cues.length);
    expect(v3CuesBetween(before, after)).toEqual(cues);
    expect(v3CuesBetween(after, after)).toEqual([]);
  });

  it("does not carry cues across a stage change", () => {
    const before = view();
    const after = view({
      stage: { index: 1, count: 2, title: "Next", timePlace: "Elsewhere", centralQuestion: "Again?", intro: null },
      notes: [{ id: "n", text: "New", source: "document", stageIndex: 1, at: "2026-10-19T00:00:00.000Z" }],
    });
    expect(v3CuesBetween(before, after)).toEqual([]);
  });
});
