import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CharacterPortrait } from "@/components/play/v3/character-portrait";
import { DialogueBox, nextChoiceIndex, typewriterSlice } from "@/components/play/v3/dialogue-box";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { NotesPanel } from "@/components/play/v3/notes-panel";
import { RevealScreen } from "@/components/play/v3/reveal-screen";
import { StagePlayScreen, firstV3CollectedDocumentId, submitV3NoteInsert, v3InsertNoteAction, v3SelectPassageAction } from "@/components/play/v3/stage-play-screen";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import { createV3PlayClient } from "@/lib/play/v3/client";
import { buildInterviewAnswerAction } from "@/lib/play/v3/interview-form";
import { offsetsFromParagraphs } from "@/lib/play/v3/passage-offsets";
import { portraitFile, portraitStoragePrefix, portraitUrl, v3PortraitBase } from "@/lib/play/v3/portraits";
import { createV3PreviewClient } from "@/lib/play/v3/preview-client";
import { mockViews } from "@adventure/engine/mock";
import {
  MAX_EVIDENCE_NOTES,
  MAX_INTERVIEW_TEXT_LENGTH,
  type CharacterView,
  type DefiningMomentView,
  type MessageView,
  type PlayerView,
} from "@adventure/play-contract";

vi.mock("next/font/google", () => ({
  Pixelify_Sans: () => ({ className: "pixelify-sans" }),
}));

const view = { phase: "briefing", pendingCheck: false } as unknown as PlayerView;
const continueAction = { type: "continue" } as const;

function stagePlayView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: "stage",
    briefing: { name: "Temenggong Abdul Rahman", position: "Temenggong", relationships: [], reputation: "", stakes: "", privateBrief: { goals: [], fears: [], constraints: [], knows: [] }, situation: "" },
    stage: {
      index: 0,
      count: 1,
      title: "The landing",
      timePlace: "Singapore, 1819",
      centralQuestion: "Who will shape the island?",
      intro: null,
    },
    rooms: [{ id: "landing", name: "The landing" }, { id: "balai", name: "The balai" }],
    currentRoomId: "landing",
    characters: [{ id: "character-1", name: "Temenggong", title: "Temenggong", stanceId: null, portraitKey: "temenggong" }],
    messages: [],
    notes: [],
    documents: [],
    documentsHere: [],
    definingMoment: null,
    timer: null,
    pendingCheck: false,
    ...overrides,
  } as unknown as PlayerView;
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("v3 play browser client", () => {
  it("maps a successful action response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, { revision: 3, view }));
    const result = await createV3PlayClient("attempt/1", fetchImpl).act(2, continueAction);
    expect(result).toEqual({ ok: true, revision: 3, view });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v3/attempts/attempt%2F1/actions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ revision: 2, action: continueAction }),
    }));
  });

  it("adopts a stale revision without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(409, {
      error: { code: "stale_state", message: "Changed." },
      revision: 5,
      view,
    }));
    const result = await createV3PlayClient("attempt-1", fetchImpl).act(2, continueAction);
    expect(result).toEqual({ ok: false, kind: "stale", revision: 5, view });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rate_limited", "rate_limited"],
    ["attempt_limit", "attempt_limit"],
  ] as const)("maps 429 %s responses", async (code, kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(429, {
      error: { code, message: "Please wait." },
    }));
    expect(await createV3PlayClient("attempt-1", fetchImpl).act(1, continueAction))
      .toEqual({ ok: false, kind, message: "Please wait." });
  });

  it("maps server failures and refreshes with GET", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(503, { error: { code: "unavailable", message: "Try later." } }))
      .mockResolvedValueOnce(response(200, { revision: 9, view }));
    const client = createV3PlayClient("attempt-1", fetchImpl);
    expect(await client.act(1, continueAction)).toEqual({ ok: false, kind: "error", message: "Try later." });
    expect(await client.refresh()).toEqual({ ok: true, revision: 9, view });
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "GET", cache: "no-store" }));
  });
});

describe("v3 preview browser client", () => {
  const initialToken = "preview-token-0";
  const nextToken = "preview-token-1";
  const checkedToken = "preview-token-2";

  it("sends and adopts client state across actions", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { token: nextToken, view, pendingCheckIds: [] }))
      .mockResolvedValueOnce(response(200, { token: checkedToken, view, pendingCheckIds: [] }));
    const client = createV3PreviewClient("adventure/1", initialToken, view, fetchImpl);

    expect(await client.act(0, continueAction)).toEqual({ ok: true, revision: 1, view });
    expect(await client.act(1, continueAction)).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/v3/preview/adventure%2F1/actions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: initialToken, action: continueAction }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v3/preview/adventure%2F1/actions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: nextToken, action: continueAction }),
    }));
  });

  it("refreshes pending checks and makes no request when none are pending", async () => {
    const emptyFetch = vi.fn<typeof fetch>();
    const emptyClient = createV3PreviewClient("adventure-1", initialToken, view, emptyFetch);
    expect(await emptyClient.refresh()).toEqual({ ok: true, revision: 0, view });
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { token: nextToken, view, pendingCheckIds: ["message-1"] }))
      .mockResolvedValueOnce(response(200, { token: checkedToken, view, pendingCheckIds: [] }));
    const client = createV3PreviewClient("adventure-1", initialToken, view, fetchImpl);
    await client.act(0, continueAction);
    expect(await client.refresh()).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v3/preview/adventure-1/check", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: nextToken, messageId: "message-1" }),
    }));
    expect(await client.refresh()).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serializes an action and refresh so the check uses the action's state", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { token: nextToken, view, pendingCheckIds: ["message-1"] }))
      .mockResolvedValueOnce(response(200, { token: checkedToken, view, pendingCheckIds: [] }));
    const client = createV3PreviewClient("adventure-1", initialToken, view, fetchImpl);
    const action = client.act(0, continueAction);
    const refresh = client.refresh();

    const [actionResult, refreshResult] = await Promise.all([action, refresh]);
    expect(actionResult).toEqual({ ok: true, revision: 1, view });
    expect(refreshResult).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v3/preview/adventure-1/check", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: nextToken, messageId: "message-1" }),
    }));
  });
});

describe("passage offsets", () => {
  it("maps a selection spanning paragraphs to exact body offsets", () => {
    const paragraphs = ["A letter from the harbour.", "", "The tide changed before dawn."];
    const body = paragraphs.join("\n");
    const offsets = offsetsFromParagraphs(paragraphs, { paragraph: 0, offset: 2 }, { paragraph: 2, offset: 8 });
    expect(offsets).toEqual({ start: 2, end: paragraphs[0].length + 2 + 8 });
    expect(body.slice(offsets!.start, offsets!.end)).toBe("letter from the harbour.\n\nThe tide");
  });

  it("rejects invalid, collapsed, and backwards selections", () => {
    expect(offsetsFromParagraphs(["text"], { paragraph: 0, offset: 1 }, { paragraph: 0, offset: 1 })).toBeNull();
    expect(offsetsFromParagraphs(["text"], { paragraph: 1, offset: 0 }, { paragraph: 1, offset: 2 })).toBeNull();
    expect(offsetsFromParagraphs(["text"], { paragraph: 0, offset: 3 }, { paragraph: 0, offset: 1 })).toBeNull();
  });
});

describe("v3 stance portrait paths", () => {
  it("sanitizes portrait keys into webp file names", () => {
    expect(portraitFile("ahmad:steady/slash")).toBe("ahmad_steady_slash.webp");
  });

  it("scopes storage paths and public bases to an adventure version", () => {
    expect(portraitStoragePrefix("adventure-1", 4)).toBe("v3/portraits/adventure-1/v4");
    expect(v3PortraitBase("adventure-1", 4, "https://supabase.example.test/"))
      .toBe("https://supabase.example.test/storage/v1/object/public/assets/v3/portraits/adventure-1/v4");
    expect(v3PortraitBase("adventure-1", 4, "")).toBeNull();
    expect(portraitUrl("ahmad:steady", "https://cdn.example.test/portraits/"))
      .toBe("https://cdn.example.test/portraits/ahmad_steady.webp");
    expect(portraitUrl("ahmad:steady", null)).toBeNull();
  });

  it("renders an image when a base is present and initials without one", () => {
    vi.stubGlobal("React", React);
    try {
      const image = renderToStaticMarkup(createElement(CharacterPortrait, {
        name: "Temenggong Abdul Rahman",
        portraitKey: "temenggong:t1",
        portraitBase: "https://cdn.example.test/v3/portraits/adventure/v1",
        selected: false,
        onSelect: () => {},
      }));
      expect(image).toContain('src="https://cdn.example.test/v3/portraits/adventure/v1/temenggong_t1.webp"');

      const fallback = renderToStaticMarkup(createElement(CharacterPortrait, {
        name: "Temenggong Abdul Rahman",
        portraitKey: "temenggong:t1",
        portraitBase: null,
        selected: false,
        onSelect: () => {},
      }));
      expect(fallback).toContain(">TA</span>");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("v3 stage play screen", () => {
  it("shows the Mission card and map fallback while retaining notes and documents", () => {
    const stageView = stagePlayView({
      notes: [{ id: "note-1", text: "A useful discovery.", source: "document", stageIndex: 0, at: "2026-01-01T00:00:00.000Z" }],
      documents: [{
        id: "document-1",
        kind: "letter",
        title: "A letter from the harbour",
        provenance: { masthead: null, date: null, sender: null, recipient: null, place: null },
        body: "The harbour is busy.",
        real: false,
        sourceLabel: null,
        glossary: [],
        open: false,
      }],
      documentsHere: [{ id: "document-1", kind: "letter", title: "A letter from the harbour" }],
    });

    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(StagePlayScreen, {
        view: stageView,
        busy: false,
        send: () => {},
        attemptId: "preview-attempt",
      }));
      const mission = markup.match(/<section aria-label="Mission"[\s\S]*?<\/section>/)?.[0] ?? "";

      expect(markup).not.toContain("<aside");
      expect(markup).not.toContain("People here");
      expect(markup).not.toContain("Look around");
      expect(mission).toContain("Mission");
      expect(mission).toContain("Who will shape the island?");
      expect(mission).toContain("ready to decide");
      expect(mission).toContain('aria-expanded="true"');
      expect(mission).toContain("Walk to");
      expect(markup).toContain("Notes (1)");
      expect(markup).toContain("Documents (1)");
      expect(markup).not.toContain('id="v3-message"');
      expect(markup).not.toContain("Say hello");
      expect(markup).not.toContain("Move to");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows defining moments in the map dialogue box instead of the ready-to-decide controls", () => {
    const moment = {
      momentId: "moment-1",
      scene: "The landing may decide Singapore's future.",
      deciderId: "character-1",
      deciderName: "Temenggong Abdul Rahman",
      status: "choosing",
      acts: [{ id: "act-1", text: "Welcome the British ships." }],
      nudge: null,
      chosenActId: null,
      reaction: null,
      predictionOptions: [],
    } as unknown as DefiningMomentView;
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(StagePlayScreen, {
        view: stagePlayView({ definingMoment: moment }),
        busy: false,
        send: () => {},
        attemptId: "preview-attempt",
      }));
      const mission = markup.match(/<section aria-label="Mission"[\s\S]*?<\/section>/)?.[0] ?? "";

      expect(markup).toContain("A defining moment");
      expect(markup).toContain("The landing may decide Singapore");
      expect(markup).toContain("Welcome the British ships.");
      expect(mission).toContain("Who will shape the island?");
      expect(mission).not.toContain("I'm ready to decide");
      expect(mission).not.toContain("Walk to");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds the insertNote action used by the Notes modal", () => {
    expect(v3InsertNoteAction("character-1", "note-1", "I noticed this detail.")).toEqual({
      type: "insertNote",
      characterId: "character-1",
      noteId: "note-1",
      text: "I noticed this detail.",
    });
  });

  it("renders the Notes scroll with its saved note and insert action", () => {
    const notes = [{ id: "note-1", text: "A useful discovery.", source: "document" as const, stageIndex: 0, at: "2026-01-01T00:00:00.000Z" }];
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(
        V3ScrollDialog,
        {
          eyebrow: "Your notes",
          title: "Your notes",
          kicker: "From your travels",
          footerText: "A record of your discoveries",
          closeLabel: "Close notes",
          onClose: () => {},
        },
        createElement(NotesPanel, {
          notes,
          busy: false,
          selectedCharacterName: "Temenggong",
          onInsert: () => {},
        }),
      ));
      const emptyMarkup = renderToStaticMarkup(createElement(NotesPanel, {
        notes: [],
        busy: false,
        selectedCharacterName: null,
        onInsert: () => {},
      }));

      expect(markup).toContain("Your notes");
      expect(markup).toContain("From your travels");
      expect(markup).toContain("From the historical record");
      expect(markup).toContain("A useful discovery.");
      expect(markup).toContain("Optional comment for Temenggong");
      expect(markup).toContain("Insert into chat");
      expect(markup).toContain("Roll up scroll");
      expect(emptyMarkup).toContain("No notes yet.");
      expect(emptyMarkup).toContain("Talk to people and read documents.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders collected documents as navigable scrolls and shows the empty state", () => {
    const documents: PlayerView["documents"] = [
      {
        id: "document-1",
        kind: "letter",
        title: "A letter from the harbour",
        provenance: { masthead: null, date: null, sender: null, recipient: null, place: null },
        body: "The harbour is busy.\nShips are arriving.",
        real: false,
        sourceLabel: null,
        glossary: [],
        open: false,
      },
      {
        id: "document-2",
        kind: "minutes",
        title: "Council minutes",
        provenance: { masthead: null, date: null, sender: null, recipient: null, place: null },
        body: "The council met.",
        real: false,
        sourceLabel: null,
        glossary: [],
        open: false,
      },
    ];

    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DocumentReader, {
        document: documents[0]!,
        documents,
        onSelectDocument: () => {},
        onClose: () => {},
        onSelectPassage: () => {},
      }));
      const emptyMarkup = renderToStaticMarkup(createElement(DocumentReader, {
        document: null,
        documents: [],
        onSelectDocument: () => {},
        onClose: () => {},
      }));

      expect(markup).toContain("Collected scroll 1 of 2");
      expect(markup).toContain("From your travels");
      expect(markup).toContain("A letter from the harbour");
      expect(markup).toContain("Choose a collected scroll");
      expect(markup).toContain("Saved in your notes");
      expect(markup).toContain("Roll up scroll");
      expect(markup).toContain("data-document-paragraph");
      expect(emptyMarkup).toContain("No scrolls collected yet.");
      expect(emptyMarkup).toContain("Continue exploring");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens the first collected scroll and preserves passage selection actions", () => {
    expect(firstV3CollectedDocumentId([{ id: "document-1" }])).toBe("document-1");
    expect(firstV3CollectedDocumentId([])).toBeNull();
    expect(v3SelectPassageAction("document-1", 4, 18)).toEqual({
      type: "selectPassage",
      documentId: "document-1",
      start: 4,
      end: 18,
    });
  });

  it("sends insertNote and closes the Notes scroll after insertion", () => {
    const send = vi.fn();
    const close = vi.fn();
    submitV3NoteInsert("character-1", "note-1", "A short comment.", send, close);

    expect(send).toHaveBeenCalledWith({
      type: "insertNote",
      characterId: "character-1",
      noteId: "note-1",
      text: "A short comment.",
    });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("v3 dialogue box", () => {
  const character = {
    id: "character-1",
    name: "Temenggong Abdul Rahman",
    title: "Temenggong",
    stanceId: null,
    portraitKey: "temenggong",
  } as unknown as CharacterView;
  const message = {
    id: "message-1",
    kind: "character",
    characterId: character.id,
    roomId: "landing",
    text: "The harbour is open to all who arrive in peace.",
    insertedNoteId: "note-1",
    at: "2026-01-01T00:00:00.000Z",
    speaker: character.name,
    insertedNoteText: "The tide changes before dawn.",
  } as unknown as MessageView & { speaker: string; insertedNoteText: string };
  const moment = {
    momentId: "moment-1",
    scene: "A defining scene.",
    deciderId: "character-1",
    deciderName: "Temenggong Abdul Rahman",
    status: "choosing",
    acts: [
      { id: "act-1", text: "Welcome the British ships." },
      { id: "act-2", text: "Refuse their proposal." },
    ],
    nudge: "Consider the evidence.",
    chosenActId: null,
    reaction: null,
    predictionOptions: [],
  } as unknown as DefiningMomentView;

  it("renders talk mode with the character, filtered dialogue, input, notes, and close control", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DialogueBox, {
        mode: "talk",
        character,
        portraitBase: "https://assets.example/v3/portraits",
        messages: [message],
        busy: false,
        onSend: () => {},
        onOpenNotes: () => {},
        onClose: () => {},
      }));

      expect(markup).toContain(character.name);
      expect(markup).toContain('src="https://assets.example/v3/portraits/temenggong.webp"');
      expect(markup).toContain("bg-[#1f2433]");
      expect(markup).toContain(`>${character.name}</span>`);
      expect(markup).toContain("▼");
      expect(markup).toContain(message.text);
      expect(markup).toContain("The tide changes before dawn.");
      expect(markup).toContain('id="v3-message"');
      expect(markup).toContain("Insert a note");
      expect(markup).toContain('aria-label="Close conversation (Esc)"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows character initials when the portrait base is unavailable", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DialogueBox, {
        mode: "talk",
        character,
        portraitBase: null,
        messages: [],
        busy: false,
        onSend: () => {},
        onOpenNotes: () => {},
        onClose: () => {},
      }));

      expect(markup).toContain(">TA</span>");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders all acts as listbox options with only the first selected", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DialogueBox, {
        mode: "moment",
        moment,
        portraitBase: null,
        busy: false,
        onAct: () => {},
        onPredict: () => {},
      }));

      expect(markup.match(/role="option"/g)).toHaveLength(2);
      expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
      expect(markup).toContain("▶");
      expect(markup).toContain("Welcome the British ships.");
      expect(markup).toContain("Refuse their proposal.");
      expect(markup).not.toContain("<img");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders a decider portrait in moment mode", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DialogueBox, {
        mode: "moment",
        moment,
        decider: character,
        portraitBase: "https://assets.example/v3/portraits",
        busy: false,
        onAct: () => {},
        onPredict: () => {},
      }));

      expect(markup).toContain('src="https://assets.example/v3/portraits/temenggong.webp"');
      expect(markup).toContain("A defining moment");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders a predicting reaction, decider heading, and prediction options", () => {
    const predicting = {
      ...moment,
      status: "predicting",
      reaction: "The people watch in silence.",
      predictionOptions: [
        { outcomeId: "outcome-1", text: "They will accept the proposal." },
        { outcomeId: "outcome-2", text: "They will refuse the proposal." },
      ],
    } as unknown as DefiningMomentView;
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DialogueBox, {
        mode: "moment",
        moment: predicting,
        portraitBase: null,
        busy: false,
        onAct: () => {},
        onPredict: () => {},
      }));

      expect(markup).toContain("The people watch in silence.");
      expect(markup).toContain("What will Temenggong Abdul Rahman decide?");
      expect(markup).toContain("They will accept the proposal.");
      expect(markup).toContain("They will refuse the proposal.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves source whitespace and wraps choice navigation in both directions", () => {
    expect(typewriterSlice("Talk   to them   today", 0)).toBe("");
    expect(typewriterSlice("Talk   to them   today", 3)).toBe("Talk   to them");
    expect(typewriterSlice("Talk   to them   today", 10)).toBe("Talk   to them   today");
    expect(nextChoiceIndex(0, -1, 3)).toBe(2);
    expect(nextChoiceIndex(2, 1, 3)).toBe(0);
  });
});

describe("interview answer form", () => {
  const choices = { verdictIds: ["verdict-a", "verdict-b"], noteIds: ["note-1", "note-2"] };

  it("builds an answer and omits blank optional text", () => {
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: ["note-2"], text: "   " },
      choices,
    )).toEqual({
      ok: true,
      action: { type: "interviewAnswer", verdictId: "verdict-a", evidenceNoteIds: ["note-2"] },
    });
  });

  it("trims and includes nonblank text", () => {
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-b", evidenceNoteIds: [], text: "  My reasoning.  " },
      choices,
    )).toEqual({
      ok: true,
      action: { type: "interviewAnswer", verdictId: "verdict-b", evidenceNoteIds: [], text: "My reasoning." },
    });
  });

  it("rejects verdicts and evidence that are not in the provided choices", () => {
    expect(buildInterviewAnswerAction(
      { verdictId: "unknown", evidenceNoteIds: [], text: "" },
      choices,
    )).toMatchObject({ ok: false, error: "Choose a verdict." });
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: ["unknown"], text: "" },
      choices,
    )).toMatchObject({ ok: false, error: "Choose evidence from your notes." });
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: ["note-1", "note-1"], text: "" },
      choices,
    )).toMatchObject({ ok: false, error: "Choose evidence from your notes." });
  });

  it("enforces the contract limits for evidence and text", () => {
    const tooManyNotes = Array.from({ length: MAX_EVIDENCE_NOTES + 1 }, (_, index) => `note-${index}`);
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: tooManyNotes, text: "" },
      choices,
    )).toMatchObject({ ok: false, error: `Choose no more than ${MAX_EVIDENCE_NOTES} notes.` });

    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: [], text: "x".repeat(MAX_INTERVIEW_TEXT_LENGTH + 1) },
      choices,
    )).toMatchObject({ ok: false, error: `Keep your response to ${MAX_INTERVIEW_TEXT_LENGTH} characters or fewer.` });
  });
});

describe("v3 reveal screen", () => {
  const reveal = mockViews.reveal.reveal!;

  it("ends with a finished line for students", () => {
    vi.stubGlobal("React", React);
    const markup = renderToStaticMarkup(createElement(RevealScreen, { reveal }));
    expect(markup).toContain("You&#x27;ve finished this adventure. You can close this tab.");
  });

  it("ends with the given footer instead, e.g. the preview's way back", () => {
    vi.stubGlobal("React", React);
    const markup = renderToStaticMarkup(createElement(RevealScreen, {
      reveal,
      footer: createElement("a", { href: "/teacher" }, "Back to adventures"),
    }));
    expect(markup).toContain('<a href="/teacher">Back to adventures</a>');
    expect(markup).not.toContain("You can close this tab");
  });
});
