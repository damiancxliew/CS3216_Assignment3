import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CharacterPortrait } from "@/components/play/v3/character-portrait";
import { DialogueBox, nextAvailableIndex, nextChoiceIndex, typewriterSlice } from "@/components/play/v3/dialogue-box";
import { DocumentReader, passageStatus } from "@/components/play/v3/document-reader";
import { NotePickup, unseenNotes } from "@/components/play/v3/note-pickup";
import adventureStyles from "@/components/play/adventure-chrome.module.css";
import { NotesPanel } from "@/components/play/v3/notes-panel";
import { RevealScreen } from "@/components/play/v3/reveal-screen";
import { StageIsland, documentActivityText, filterLogByCharacter, groupMessagesByStage, groupNotesByStage, logLineCount } from "@/components/play/v3/stage-island";
import { StagePlayScreen, firstV3CollectedDocumentId, submitV3NoteInsert, v3InsertNoteAction, v3SelectPassageAction } from "@/components/play/v3/stage-play-screen";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import { V3Cinematic } from "@/components/play/v3/v3-cinematic";
import { v3AudioSnapshot } from "@/components/play/v3/v3-map";
import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { V3PreviewClient, V3PreviewHeaderActions } from "@/components/play/v3/v3-preview-client";
import { createV3PlayClient } from "@/lib/play/v3/client";
import { buildInterviewAnswerAction } from "@/lib/play/v3/interview-form";
import { offsetsFromParagraphs } from "@/lib/play/v3/passage-offsets";
import { withPendingPlayerLine, withoutPendingLines } from "@/lib/play/v3/pending-lines";
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

vi.mock("@/components/play/v3/use-v3-play", () => ({
  useV3Play: (_attemptId: string, initialView: unknown) => ({
    view: initialView,
    busy: false,
    banner: null,
    send: () => {},
    clearBanner: () => {},
  }),
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
    speakers: [],
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

describe("v3 preview toolbar", () => {
  it("renders preview actions in the header without the unsaved-progress banner", () => {
    vi.stubGlobal("React", React);
    try {
      const previewView = { ...stagePlayView(), phase: "briefing" } as PlayerView;
      const markup = renderToStaticMarkup(createElement(V3PreviewClient, {
        adventureId: "adventure-1",
        initialToken: "preview-token",
        initialView: previewView,
      }));
      const header = markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";

      expect(markup).not.toContain("Progress is not saved.");
      expect(markup).not.toContain("Student preview");
      expect(header).toContain('aria-label="Restart preview"');
      expect(header).toContain("Restart preview");
      expect(header).toContain('aria-label="Back to adventure"');
      expect(header).toContain("Back to adventure");
      expect(header).toContain('href="/v3/teacher/adventure-1"');
      expect(header).toContain("hidden sm:inline");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reloads the current preview and links back to its adventure", () => {
    const reload = vi.fn();
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { reload } });
    try {
      const actions = V3PreviewHeaderActions({ adventureId: "adventure-1" });
      const actionElements = React.Children.toArray(actions.props.children);
      const restartButton = actionElements[0] as React.ReactElement<{ onClick: () => void; "aria-label": string }>;
      const backLink = actionElements[1] as React.ReactElement<{ href: string; "aria-label": string }>;

      expect(restartButton.type).toBe("button");
      expect(restartButton.props["aria-label"]).toBe("Restart preview");
      restartButton.props.onClick();
      expect(reload).toHaveBeenCalledOnce();
      expect(backLink.props.href).toBe("/v3/teacher/adventure-1");
      expect(backLink.props["aria-label"]).toBe("Back to adventure");
    } finally {
      vi.unstubAllGlobals();
    }
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
  it("shows the Mission card, map fallback, and collapsed Journal card", () => {
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
      documentsHere: [{ id: "document-1", kind: "letter", title: "A letter from the harbour", read: false }],
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
      expect(markup).toContain('<section aria-label="Journal"');
      expect(markup).toContain('aria-expanded="false"');
      expect(markup).toContain('aria-controls="stage-island-panel"');
      expect(markup).toContain('id="stage-island-panel" aria-hidden="true"');
      expect(markup).toContain("w-[min(22rem,calc(100%_-_1rem))]");
      expect(markup).toContain('aria-label="1 note"');
      expect(markup).toContain('aria-label="1 document"');
      expect(markup).toContain('aria-label="0 log lines"');
      expect(markup).toContain("Stage 1/1");
      expect(markup).toContain("Journal");
      expect(mission).not.toContain("Adding to your notes…");
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
      expect(markup).toContain('aria-expanded="false"');
      expect(markup).not.toContain("Documents (");
      expect(mission).toContain("Who will shape the island?");
      expect(mission).not.toContain("I'm ready to decide");
      expect(mission).not.toContain("Walk to");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders the expanded island with grouped notes, documents, and transcript speakers outside the room", () => {
    const islandView = stagePlayView({
      stage: { index: 1, count: 2, title: "The council", timePlace: "Singapore, 1820", centralQuestion: "What now?", intro: null },
      notes: [
        { id: "note-old", text: "An earlier record.", source: "document", stageIndex: 0, at: 10 },
        { id: "note-new", text: "A later conversation.", source: "conversation", stageIndex: 1, at: 20 },
      ],
      documents: [{
        id: "scroll-1",
        kind: "letter",
        title: "Letter from the harbour",
        provenance: { masthead: null, date: "1820", sender: "A clerk", recipient: null, place: null },
        body: "A letter body.",
        real: false,
        sourceLabel: null,
        glossary: [],
        open: false,
      }],
      messages: [
        { id: "m-brief", kind: "narration", characterId: null, roomId: null, text: "The journey begins.", insertedNoteId: null, stageIndex: null, at: 1 },
        { id: "m-player", kind: "player", characterId: "speaker-old", roomId: "room", text: "What do you think?", insertedNoteId: null, stageIndex: 0, at: 2 },
        { id: "m-speaker", kind: "character", characterId: "speaker-old", roomId: "room", text: "The harbour is changing.", insertedNoteId: "note-new", stageIndex: 0, at: 3 },
        { id: "m-later", kind: "narration", characterId: null, roomId: null, text: "The council gathers.", insertedNoteId: null, stageIndex: 1, at: 4 },
      ],
      speakers: [{ id: "speaker-old", name: "Archivist", title: "Keeper of records" }],
    });

    vi.stubGlobal("React", React);
    try {
      const renderTab = (initialTab: "notes" | "documents" | "log") => renderToStaticMarkup(createElement(StageIsland, {
        view: islandView,
        onOpenDocument: () => {},
        initialExpanded: true,
        initialTab,
      }));
      const notesMarkup = renderTab("notes");
      const documentsMarkup = renderTab("documents");
      const logMarkup = renderTab("log");

      expect(notesMarkup).toContain('id="stage-island-panel"');
      expect(notesMarkup).toContain('aria-expanded="true"');
      expect(notesMarkup).toContain('id="stage-island-panel" aria-hidden="false"');
      expect(notesMarkup).toContain("w-[min(22rem,calc(100%_-_1rem))]");
      expect(notesMarkup.indexOf('<section aria-label="Stage 2 notes">'))
        .toBeLessThan(notesMarkup.indexOf('<section aria-label="Stage 1 notes">'));
      expect(notesMarkup).toContain("A later conversation.");
      expect(notesMarkup).toContain("From a conversation");
      expect(documentsMarkup).toContain("Letter from the harbour");
      expect(documentsMarkup).toContain("1820");
      expect(documentsMarkup).toContain("A clerk");
      expect(logMarkup).toContain("The journey begins.");
      expect(logMarkup).toContain("Archivist");
      expect(logMarkup).toContain("The harbour is changing.");
      expect(logMarkup).toContain("<blockquote");
      expect(logMarkup).toContain("Stage 1");
      expect(logLineCount(islandView.messages)).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps Notes visible but disabled during a defining moment", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(StageIsland, {
        view: stagePlayView(),
        onOpenDocument: () => {},
        definingMoment: true,
        initialExpanded: true,
      }));
      expect(markup).toContain('role="tab" id="stage-island-tab-notes"');
      expect(markup).toContain('title="Notes are closed during the decision"');
      expect(markup).toContain('disabled=""');
      expect(markup).toContain('role="tab" id="stage-island-tab-documents"');
      expect(markup).toContain('role="tab" id="stage-island-tab-log"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the Documents empty state in the Journal tab", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(StageIsland, {
        view: stagePlayView({ documents: [] }),
        onOpenDocument: () => {},
        initialExpanded: true,
        initialTab: "documents",
      }));
      expect(markup).toContain("No documents collected yet.");
      expect(markup).toContain("Every document you collect will be saved here.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders a keyed pulse span in the Journal card for a new-note pickup", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(StageIsland, {
        view: stagePlayView(),
        onOpenDocument: () => {},
        pulseKey: "note-1",
      }));
      expect(markup).toContain(adventureStyles.islandPulse);
      expect(markup).toMatch(new RegExp(`<span aria-hidden="true" class="pointer-events-none absolute inset-0 rounded-\\[inherit\\] ${adventureStyles.islandPulse}"></span>`));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves the pending note-check status to the island", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(StagePlayScreen, {
        view: stagePlayView({ pendingCheck: true }),
        busy: false,
        send: () => {},
        attemptId: "preview-attempt",
      }));
      const mission = markup.match(/<section aria-label="Mission"[\s\S]*?<\/section>/)?.[0] ?? "";
      expect(markup).toContain("Adding to your notes…");
      expect(markup).toContain('role="status"');
      expect(markup).not.toContain('aria-label="0 notes"');
      expect(mission).not.toContain("Adding to your notes…");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("groups notes and messages by stage and formats activity summaries", () => {
    const note = (id: string, stageIndex: number, at: number, text = id) => ({
      id, text, source: "conversation" as const, stageIndex, at,
    });
    const messages = [
      { id: "m-stage2", kind: "character", characterId: "c1", roomId: "r", text: "Second", insertedNoteId: null, stageIndex: 1, at: 3 },
      { id: "m-brief", kind: "narration", characterId: null, roomId: null, text: "First", insertedNoteId: null, stageIndex: null, at: 1 },
      { id: "m-stage1", kind: "player", characterId: null, roomId: "r", text: "Middle", insertedNoteId: null, stageIndex: 0, at: 2 },
    ] satisfies MessageView[];
    expect(groupNotesByStage([note("old", 0, 1), note("new", 2, 4), note("middle", 1, 3)]).map((group) => group.stageIndex)).toEqual([2, 1, 0]);
    expect(groupNotesByStage([note("older", 2, 1), note("newer", 2, 2)])[0]?.notes.map(({ id }) => id))
      .toEqual(["newer", "older"]);
    expect(groupMessagesByStage(messages).map((group) => group.stageIndex)).toEqual([null, 0, 1]);
    expect(documentActivityText({ title: "A dispatch" })).toBe("+1 document: A dispatch");
    expect(documentActivityText({ title: "A dispatch" }, 2)).toBe("+2 documents: A dispatch");
  });

  it("filters a character's lines and the contiguous player turns immediately before them", () => {
    const messages = [
      { id: "p1", kind: "player", characterId: "a", roomId: "r", text: "First question", insertedNoteId: null, stageIndex: 0, at: 1 },
      { id: "p2", kind: "player", characterId: "a", roomId: "r", text: "Follow-up", insertedNoteId: null, stageIndex: 0, at: 2 },
      { id: "a1", kind: "character", characterId: "a", roomId: "r", text: "Answer", insertedNoteId: null, stageIndex: 0, at: 3 },
      { id: "b1", kind: "character", characterId: "b", roomId: "r", text: "Other voice", insertedNoteId: null, stageIndex: 0, at: 4 },
      { id: "p3", kind: "player", characterId: "b", roomId: "r", text: "Different question", insertedNoteId: null, stageIndex: 0, at: 5 },
      { id: "thought", kind: "thought", characterId: null, roomId: null, text: "A thought", insertedNoteId: null, stageIndex: 0, at: 6 },
      { id: "a2", kind: "character", characterId: "a", roomId: "r", text: "Another answer", insertedNoteId: null, stageIndex: 0, at: 7 },
    ] satisfies MessageView[];
    expect(filterLogByCharacter(messages, "a").map((message) => message.id)).toEqual(["p1", "p2", "a1", "a2"]);
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
      expect(markup).not.toContain("Optional comment");
      expect(markup).not.toContain("<textarea");
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
      expect(markup).toContain("Collected");
      expect(markup).not.toContain("Saved in your notes");
      expect(markup).toContain("Tip: drag across the line that matters to save it as a note.");
      expect(markup).toContain("Roll up scroll");
      expect(markup).toContain("data-document-paragraph");
      expect(emptyMarkup).toContain("No scrolls collected yet.");
      expect(emptyMarkup).toContain("Continue exploring");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("teaches highlighting until the first document note, and stops once close reading is over", () => {
    const documents: PlayerView["documents"] = [{
      id: "document-1",
      kind: "letter",
      title: "A letter from the harbour",
      provenance: { masthead: null, date: null, sender: null, recipient: null, place: null },
      body: "The harbour is busy.",
      real: false,
      sourceLabel: null,
      glossary: [],
      open: false,
    }];
    vi.stubGlobal("React", React);
    try {
      const render = (props: Partial<Parameters<typeof DocumentReader>[0]>) => renderToStaticMarkup(createElement(DocumentReader, {
        document: documents[0]!,
        documents,
        onSelectDocument: () => {},
        onClose: () => {},
        ...props,
      }));
      const later = render({ onSelectPassage: () => {}, hasDocumentNote: true });
      expect(later).toContain("Highlight the line that matters to save it as a note.");
      expect(later).not.toContain("Tip:");
      const moment = render({ hasDocumentNote: false });
      expect(moment).toContain("time to decide now");
      expect(moment).not.toContain("Tip:");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("announces each newly gained note as a pickup", () => {
    const notes = [
      { id: "n1", text: "The Temenggong governs here.", source: "conversation", stageIndex: 0, at: 1 },
      { id: "n2", text: "The Dutch claim Riau.", source: "document", stageIndex: 0, at: 2 },
    ] as const;
    expect(unseenNotes(new Set(["n1"]), notes).map((note) => note.id)).toEqual(["n2"]);
    expect(unseenNotes(new Set(["n1", "n2"]), notes)).toEqual([]);

    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(NotePickup, { note: notes[1], onOpen: () => {} }));
      expect(markup).toContain("New note · from a document");
      expect(markup).toContain("The Dutch claim Riau.");
      expect(markup).toContain('popover="manual"');
      expect(markup).toContain('role="status"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports whether a highlight added a note, only for the scroll it was made on", () => {
    const pending = { documentId: "d1", notesBefore: 2, settled: false, succeeded: false };
    expect(passageStatus(null, "d1", 2)).toBeNull();
    expect(passageStatus(pending, "d1", 2)).toBe("checking");
    expect(passageStatus({ ...pending, settled: true, succeeded: true }, "d1", 3)).toBe("added");
    expect(passageStatus({ ...pending, settled: true, succeeded: true }, "d1", 2)).toBe("nothing");
    expect(passageStatus({ ...pending, settled: true, succeeded: false }, "d1", 2)).toBeNull();
    expect(passageStatus({ ...pending, settled: true, succeeded: true }, "d2", 3)).toBeNull();
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

describe("v3 cinematic", () => {
  it("keeps every beat in the DOM and uses the dark fallback without art", () => {
    vi.stubGlobal("React", React);
    try {
      const beats = [
        { id: "role", kicker: "Your role", title: "Ahmad", body: "Interpreter" },
        { id: "question", kicker: "The question", body: "Who will shape the island?" },
      ];
      const markup = renderToStaticMarkup(createElement(V3Cinematic, {
        artUrl: null,
        beats,
        beginLabel: "Enter the first stage",
        onBegin: () => {},
        muted: true,
        onToggleMuted: () => {},
      }));
      const settled = renderToStaticMarkup(createElement(V3Cinematic, {
        artUrl: "https://assets.example/stage-0.webp",
        beats,
        beginLabel: "Enter the first stage",
        onBegin: () => {},
        muted: false,
        onToggleMuted: () => {},
        initiallySettled: true,
      }));

      expect(markup).toContain("Your role");
      expect(markup).toContain("The question");
      expect(markup.match(/data-active="true"/g)).toHaveLength(1);
      expect(markup).not.toContain("<img");
      expect(markup).toContain("radial-gradient");
      expect(markup).toContain("Skip");
      expect(markup).toContain('aria-label="Sound off"');
      expect(settled).toContain("Enter the first stage");
      expect(settled.match(/data-active="true"/g)).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers Role brief in the stage-play header", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(V3PlayClient, {
        attemptId: "attempt",
        initialView: stagePlayView(),
        initialRevision: 1,
        stageArtBase: "https://assets.example/stage-art",
      }));
      expect(markup).toContain('aria-label="Role brief"');
      expect(markup).toContain("Role brief");
      expect(markup).toContain('aria-expanded="false"');
      expect(markup).toContain('aria-label="Sound off"');
      expect(markup).toContain('aria-pressed="false"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes atmosphere and sound cues into the V3Map snapshot", () => {
    const ambient = { id: "rain", intensity: 1 } as const;
    const audio = { muted: false, cues: [{ key: "accept:0:1", id: "accept" as const }] };
    expect(v3AudioSnapshot(ambient, audio)).toEqual({ ambient, audio });
  });

  it("retains room-derived weather alongside sound controls and cues", () => {
    const audio = { muted: false, cues: [{ key: "accept:0:1", id: "accept" as const }] };
    const scenery = { storyContext: "Harbour office", roomDescriptions: { office: "Rainy streets outside the office." } };
    expect(v3AudioSnapshot({ id: "clear", intensity: 1 }, audio, scenery)).toEqual({
      ambient: { id: "rain", intensity: 1 }, audio,
    });
    const storm = { id: "thunderstorm", intensity: 0.5 } as const;
    expect(v3AudioSnapshot(storm, audio, scenery)).toEqual({ ambient: storm, audio });
  });
});

describe("v3 pending player lines", () => {
  const base = { currentRoomId: "landing", messages: [] } as unknown as PlayerView;

  it("shows a sent message or shown note straight away, in the current room", () => {
    const sent = withPendingPlayerLine(base, { type: "message", characterId: "raffles", text: "Why here?" }, "1", 5);
    expect(sent.messages).toEqual([
      { id: "pending-1", kind: "player", text: "Why here?", roomId: "landing", characterId: "raffles", insertedNoteId: null, stageIndex: null, at: 5 },
    ]);
    const shown = withPendingPlayerLine(sent, { type: "insertNote", characterId: "raffles", noteId: "n1" }, "2", 6);
    expect(shown.messages[1]).toMatchObject({ id: "pending-2", text: "", insertedNoteId: "n1" });
  });

  it("ignores other actions and drops pending lines after a failed send", () => {
    expect(withPendingPlayerLine(base, { type: "tick" }, "1", 5)).toBe(base);
    const sent = withPendingPlayerLine(base, { type: "message", characterId: "raffles", text: "Hi" }, "1", 5);
    expect(withoutPendingLines(sent).messages).toEqual([]);
    expect(withoutPendingLines(base)).toBe(base);
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
    stageIndex: 0,
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
      expect(markup).not.toContain("▼");
      expect(markup).toContain(message.text);
      expect(markup).toContain("The tide changes before dawn.");
      expect(markup).toContain('id="v3-message"');
      expect(markup).toContain("Insert a note");
      expect(markup).toContain('aria-label="Close conversation (Esc)"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says the character is thinking while the reply to the student's line is on its way", () => {
    vi.stubGlobal("React", React);
    try {
      const own = { ...message, id: "pending-1", kind: "player", text: "Why here?", insertedNoteId: null } as typeof message;
      const props = { mode: "talk" as const, character, portraitBase: null, onSend: () => {}, onOpenNotes: () => {}, onClose: () => {} };
      const waiting = renderToStaticMarkup(createElement(DialogueBox, { ...props, messages: [message, own], busy: true }));
      expect(waiting).toContain("Why here?");
      expect(waiting).toContain(`${character.name} is thinking`);
      expect(renderToStaticMarkup(createElement(DialogueBox, { ...props, messages: [message, own], busy: false }))).not.toContain("is thinking");
      expect(renderToStaticMarkup(createElement(DialogueBox, { ...props, messages: [message], busy: true }))).not.toContain("is thinking");
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

  it("strikes out acts that can no longer happen and keeps the cursor off them", () => {
    vi.stubGlobal("React", React);
    try {
      const markup = renderToStaticMarkup(createElement(DialogueBox, {
        mode: "moment",
        moment: { ...moment, acts: [{ id: "act-1", text: "Welcome the British ships.", available: false }, { id: "act-2", text: "Refuse their proposal.", available: true }] },
        portraitBase: null,
        busy: false,
        onAct: () => {},
        onPredict: () => {},
      }));
      expect(markup).toContain("line-through");
      expect(markup).toContain("(no longer possible)");
      expect(markup.match(/aria-disabled="true"/g)).toHaveLength(1);
      expect(markup).toMatch(/aria-selected="true"[^>]*>[\s\S]*?Refuse their proposal/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(nextAvailableIndex(1, 1, [false, true, false, true])).toBe(3);
    expect(nextAvailableIndex(3, 1, [false, true, false, true])).toBe(1);
    expect(nextAvailableIndex(1, -1, [false, true, false, true])).toBe(3);
    expect(nextAvailableIndex(0, 1, [false, false])).toBe(0);
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

  it("lays the stages out as a timeline with the student's act, prediction and history side by side", () => {
    vi.stubGlobal("React", React);
    const markup = renderToStaticMarkup(createElement(RevealScreen, {
      reveal: {
        ...reveal,
        pathVsHistory: [
          { stageIndex: 0, yours: "He signed and sent for Hussein.", history: "He signed and sent for Hussein.", matched: true, closedEndings: [], act: "Warn him.", prediction: { text: "He will sign.", correct: true } },
          { stageIndex: 1, yours: "Raffles waited.", history: "Raffles signed.", matched: false, closedEndings: ["One chief's word"], act: "Advise him to wait.", prediction: { text: "He will sign.", correct: false } },
        ],
      },
    }));
    expect(markup).toContain("<ol");
    expect(markup).toContain("In your story and in history");
    expect(markup).toContain("Went differently");
    expect(markup).toContain("In history");
    expect(markup).toContain("Advise him to wait.");
    expect(markup).toContain("Not quite");
    expect(markup).toContain("This closed off: One chief&#x27;s word");
  });

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
