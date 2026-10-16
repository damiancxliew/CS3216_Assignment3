import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EngineSpec, createState, type EngineState } from "@adventure/engine";
import type { InterviewView, NoteView, PlayerView } from "@adventure/play-contract";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { InterviewScreen } from "@/components/play/v3/interview-screen";
import { backdropFromState, backdropFromView } from "@/lib/play/v3/backdrop";
import { DEFAULT_CLOSING, interviewDraftStart, interviewLine } from "@/lib/play/v3/interview-flow";

const goldenSpec = EngineSpec.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/golden-1819.json"), "utf8")));

const interview: InterviewView = {
  interviewer: "A Company clerk, 1824",
  question: "Was the treaty inevitable?",
  verdicts: [
    { id: "yes", text: "Yes, it was coming either way." },
    { id: "no", text: "No, it turned on one choice." },
  ],
  answer: null,
  pushBack: null,
  response: null,
  closing: null,
  closed: false,
};
const notes: NoteView[] = [
  { id: "note-1", text: "The Sultan was in debt.", source: "Sultan", stageIndex: 0, at: 0 } as NoteView,
];

describe("interview flow", () => {
  beforeAll(() => {
    vi.stubGlobal("React", React);
  });

  it("moves from the question to the push-back to the closing", () => {
    expect(interviewLine(interview)).toEqual({ kind: "question", text: interview.question, next: "answer" });

    const answered = { ...interview, answer: { verdictId: "no", evidenceNoteIds: ["note-1"], text: null }, pushBack: "But the British had ships." };
    expect(interviewLine(answered)).toEqual({ kind: "pushBack", text: "But the British had ships.", next: "respond" });

    const closed = { ...answered, response: { verdictId: "yes", evidenceNoteIds: [], text: null }, closing: null, closed: true };
    expect(interviewLine(closed)).toEqual({ kind: "closing", text: DEFAULT_CLOSING, next: "continue" });
  });

  it("starts the response from the first answer", () => {
    expect(interviewDraftStart(interview)).toEqual({ verdictIndex: 0, evidenceNoteIds: [] });
    expect(interviewDraftStart({ ...interview, answer: { verdictId: "no", evidenceNoteIds: ["note-1"], text: "x" } }))
      .toEqual({ verdictIndex: 1, evidenceNoteIds: ["note-1"] });
  });

  it("asks the question over the map with the verdict panel open", () => {
    const html = renderToStaticMarkup(createElement(InterviewScreen, { interview, notes, busy: false, send: () => {} }));
    expect(html).toContain("A Company clerk, 1824");
    expect(html).toContain("Was the treaty inevitable?");
    expect(html).toContain("Your answer");
    expect(html).toMatch(/aria-selected="true"[^>]*>.*▶.*Yes, it was coming either way\./);
  });

  it("labels the push-back and waits for the student before the response panel", () => {
    const html = renderToStaticMarkup(createElement(InterviewScreen, {
      interview: { ...interview, answer: { verdictId: "no", evidenceNoteIds: [], text: null }, pushBack: "But the British had ships." },
      notes,
      busy: false,
      send: () => {},
    }));
    expect(html).toContain("It pushes back");
    expect(html).toContain("But the British had ships.");
    expect(html).toContain("Respond");
    expect(html).not.toContain("Your response");
  });
});

describe("map backdrop", () => {
  it("keeps the last stage's map after the stages end", () => {
    const last = goldenSpec.stages.length - 1;
    const stage = goldenSpec.stages[last];
    const character = goldenSpec.characters[0];
    const state = createState(goldenSpec, "seed") as EngineState;
    state.phase = "interview";
    state.stageIndex = last;
    state.playerRoomId = stage.startRoomId;
    state.characters[character.id] = { ...state.characters[character.id], roomId: stage.startRoomId, stanceId: null };

    const backdrop = backdropFromState(goldenSpec, state);
    expect(backdrop).toMatchObject({ stageIndex: last, currentRoomId: stage.startRoomId });
    expect(backdrop?.rooms).toEqual(stage.rooms.map(({ id, name }) => ({ id, name })));
    expect(backdrop?.characters.map(({ id }) => id)).toContain(character.id);

    expect(backdropFromState(goldenSpec, { ...state, phase: "reveal" })).toBeNull();
  });

  it("only takes the map from a stage that is being played", () => {
    expect(backdropFromView({ phase: "interview", stage: null, rooms: [] } as unknown as PlayerView)).toBeNull();
    const rooms = [{ id: "harbour", name: "Harbour" }];
    expect(backdropFromView({
      phase: "stage",
      stage: { index: 2, intro: null },
      rooms,
      currentRoomId: "harbour",
      characters: [],
    } as unknown as PlayerView)).toEqual({ stageIndex: 2, rooms, currentRoomId: "harbour", characters: [] });
  });
});
