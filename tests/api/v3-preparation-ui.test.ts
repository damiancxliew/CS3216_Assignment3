import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentView, StageView } from "@adventure/play-contract";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { ReadingCheck, sourceSentenceSelections } from "@/components/play/v3/reading-check";
import { guidanceWasSeen, rememberGuidance } from "@/components/play/v3/preparation-dialog";
import { stageIntroBeats } from "@/lib/play/v3/cinematic";

const question = { id: "q1", prompt: "What does this account support?", options: [{ id: "a", text: "Supplies were limited." }, { id: "b", text: "Everyone had enough." }, { id: "c", text: "The account says nothing about supplies." }] };
const document: DocumentView = {
  id: "letter", title: "The supply letter", body: "The boats arrived. Only three sacks remained. More were expected tomorrow.",
  kind: "letter", provenance: { masthead: null, date: null, place: null, sender: null, recipient: null }, real: false, sourceLabel: null, glossary: [], open: true,
  readingCheck: { status: "unanswered", question, recovery: null, feedback: null, explanation: null },
};

afterEach(() => vi.unstubAllGlobals());
function render(element: React.ReactElement) { vi.stubGlobal("React", React); return renderToStaticMarkup(element); }

describe("preparation guidance and reading checks", () => {
  it("requires an interpretation and supporting selection, with a keyboard alternative", () => {
    const markup = render(createElement(DocumentReader, { document, documents: [document], onClose() {}, onSelectDocument() {}, onSelectPassage() {}, onSubmitReadingCheck() {} }));
    expect(markup).toContain(question.prompt);
    expect(markup).toContain("A wrong answer needs a correction");
    expect(markup).toContain("Choose supporting sentences without dragging");
    expect(markup).toMatch(/disabled=""[^>]*>Submit answer and evidence/);
    expect(markup).not.toContain("drag across the line that matters to save it as a note");
    expect(markup).not.toContain("correctOptionId");
  });

  it("replaces a consumed question with the recovery task without revealing marking", () => {
    const recovering = { ...document, readingCheck: { ...document.readingCheck!, status: "needsReview" as const, question: null, recovery: { ...question, id: "correction", prompt: "Which claim fits the source sentence?" }, feedback: "Revisit the account before another attempt." } };
    const markup = render(createElement(ReadingCheck, { document: recovering, selection: null, onSelect() {}, onSubmit() {} }));
    expect(markup).toContain("Review the evidence before trying again");
    expect(markup).toContain("Which claim fits the source sentence?");
    expect(markup).not.toContain(question.prompt);
    expect(markup).toContain("Submit correction");
    expect(markup).not.toContain("Submit answer and evidence");
  });

  it("shows completion and explanation without requiring another answer", () => {
    const passed = { ...document, readingCheck: { ...document.readingCheck!, status: "passed" as const, question: null, explanation: "Three sacks cannot support an unlimited supply." } };
    const markup = render(createElement(ReadingCheck, { document: passed, selection: null, onSelect() {} }));
    expect(markup).toContain("Reading check complete.");
    expect(markup).toContain(passed.readingCheck.explanation);
    expect(markup).not.toContain('type="radio"');
  });

  it("keeps additional source notes accessible after the reading check passes", () => {
    const passed = { ...document, readingCheck: { ...document.readingCheck!, status: "passed" as const, question: null } };
    const markup = render(createElement(DocumentReader, { document: passed, documents: [passed], onClose() {}, onSelectDocument() {}, onSelectPassage() {} }));
    expect(markup).toContain("Choose supporting sentences without dragging");
    expect(markup).toContain("Save passage as a note");
    expect(markup).not.toContain('type="radio"');
  });

  it("preserves source quotes and raw offsets for accessible evidence choices", () => {
    const body = '  “We have three sacks.”\n\n More will arrive tomorrow! A final report.';
    const choices = sourceSentenceSelections(body);
    expect(choices.map((choice) => choice.text)).toEqual(['“We have three sacks.”', 'More will arrive tomorrow!', 'A final report.']);
    expect(choices.every((choice) => body.slice(choice.start, choice.end) === choice.text)).toBe(true);
  });

  it("introduces the essential people in the stage cinematic without changing legacy introductions", () => {
    const stage: StageView = { index: 0, count: 1, title: "Harbour", timePlace: "Morning", centralQuestion: "How should supplies be shared?", intro: null };
    expect(stageIntroBeats(stage).some((beat) => beat.id === "preparation")).toBe(false);
    stage.preparation = { completed: 0, required: 2, ready: false, hint: null, timerExpired: false, essentialConversations: [{ characterId: "ada", name: "Ada", complete: false }, { characterId: "ben", name: "Ben", complete: false }] };
    expect(stageIntroBeats(stage).find((beat) => beat.id === "preparation")?.items).toEqual(["Speak with Ada.", "Speak with Ben."]);
  });

  it("does not interrupt play when cosmetic acknowledgement storage is unavailable", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("Storage disabled"); } });
    expect(guidanceWasSeen("stage-1")).toBe(false);
    expect(() => rememberGuidance("stage-1")).not.toThrow();
  });
});
