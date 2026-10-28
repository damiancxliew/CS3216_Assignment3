import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentView, StageView } from "@adventure/play-contract";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { PreparationProgress } from "@/components/play/v3/preparation-progress";
import { ReadingCheck } from "@/components/play/v3/reading-check";
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
  it("requires an interpretation and a direct supporting highlight", () => {
    const markup = render(createElement(DocumentReader, { document, documents: [document], onClose() {}, onSelectDocument() {}, onSelectPassage() {}, onSubmitReadingCheck() {} }));
    expect(markup).toContain(question.prompt);
    expect(markup).toContain("If your answer is not supported, you can try again.");
    expect(markup).not.toContain("Choose supporting sentences without dragging");
    expect(markup).toMatch(/disabled=""[^>]*>Submit answer and evidence/);
    expect(markup).not.toContain("drag across the line that matters to save it as a note");
    expect(markup).not.toContain("correctOptionId");
  });

  it("labels source status outside the evidence body", () => {
    const reconstructed = render(createElement(DocumentReader, { document, documents: [document], onClose() {}, onSelectDocument() {} }));
    expect(reconstructed).toContain('Reconstruction');
    expect(reconstructed).toContain('Written for this adventure.');
    expect(reconstructed).toContain(document.body);
    const historical = { ...document, real: true, sourceLabel: 'MOE press release (outside source)' };
    const source = render(createElement(DocumentReader, { document: historical, documents: [historical], onClose() {}, onSelectDocument() {} }));
    expect(source).toContain('Historical source');
    expect(source).toContain('MOE press release (outside source)');
  });

  it("replaces a consumed question with the recovery task without revealing marking", () => {
    const recovering = { ...document, readingCheck: { ...document.readingCheck!, status: "needsReview" as const, question: null, recovery: { ...question, id: "correction", prompt: "Which claim fits the source sentence?" }, feedback: "Revisit the account before another attempt." } };
    const markup = render(createElement(ReadingCheck, { document: recovering, selection: null, onSelect() {}, onSubmit() {} }));
    expect(markup).toContain("Review the evidence before trying again");
    expect(markup).toContain("Which claim fits the source sentence?");
    expect(markup).not.toContain(question.prompt);
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("Submit answer and evidence");
  });

  it("shows only the failed question's answer, green source support, and Try another question before the next variation", () => {
    const revealedAnswer = { questionId: question.id, prompt: question.prompt, answer: question.options[0]!.text,
      explanation: "Three sacks cannot support an unlimited supply.", support: [{ start: 19, end: 45 }] };
    const reviewing = { ...document, readingCheck: { ...document.readingCheck!, status: "needsReview" as const,
      question: null, recovery: null, revealedAnswer } };
    const markup = render(createElement(DocumentReader, { document: reviewing, documents: [reviewing], onClose() {}, onSelectDocument() {}, onContinueReadingCheck() {} }));
    expect(markup).toContain("Correct answer:");
    expect(markup).toContain(revealedAnswer.answer);
    expect(markup).toContain(revealedAnswer.explanation);
    expect(markup).toContain('data-correct-support="">Only three sacks remained.</mark>');
    expect(markup).toContain("Supporting passage (green):");
    expect(markup).toMatch(/>Try another question<\/button>/);
    expect(markup).not.toContain("Continue to a different question");
    expect(markup).not.toContain('type="radio"');
    expect(markup).not.toContain("Reading check complete.");
    expect(markup).not.toContain("correction");
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
    expect(markup).not.toContain("Choose supporting sentences without dragging");
    expect(markup).toContain("You can save other useful passages as notes.");
    expect(markup).not.toContain('type="radio"');
  });

  it("offers clearing a highlight without a separate sentence picker", () => {
    const markup = render(createElement(ReadingCheck, { document, selection: { start: 18, end: 44 }, onSelect() {}, onSubmit() {} }));
    expect(markup).toContain('Clear highlight');
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain('choose sentences below');
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


describe("preparation progress", () => {
  it("exposes partial and completed requirements as labelled progress bars", () => {
    const partial = render(createElement(PreparationProgress, { label: "Evidence preparation", completed: 1, required: 3 }));
    expect(partial).toContain('role="progressbar" aria-label="Evidence preparation"');
    expect(partial).toContain('aria-valuenow="1"');
    expect(partial).toContain('aria-valuemax="3"');
    expect(partial).toContain('1 of 3 complete');
    const complete = render(createElement(PreparationProgress, { label: "Essential conversations", completed: 2, required: 2 }));
    expect(complete).toContain('aria-label="Complete"');
    expect(complete).toContain('width:100%');
  });
  it("shows no outstanding work when a stage has no requirement", () => {
    const markup = render(createElement(PreparationProgress, { label: "Evidence preparation", completed: 0, required: 0 }));
    expect(markup).toContain('No tasks required');
    expect(markup).toContain('width:100%');
    expect(markup).not.toContain('NaN');
  });
});
