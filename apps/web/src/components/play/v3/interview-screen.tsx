"use client";

import { useEffect, useState } from "react";
import {
  MAX_EVIDENCE_NOTES,
  MAX_INTERVIEW_TEXT_LENGTH,
  type Action,
  type InterviewView,
  type NoteView,
} from "@adventure/play-contract";

import { nextChoiceIndex, pixelFont, useTypewriter } from "@/components/play/v3/dialogue-box";
import { SpeakerBox } from "@/components/play/v3/speaker-box";
import { CHOICE_KEYS, ChoiceButton, choiceKeyIndex, pocketRoot, pocketStyles, PocketPill, PocketRibbon, PocketTag } from "@/components/play/v3/pocket-ui";
import { buildInterviewAnswerAction } from "@/lib/play/v3/interview-form";
import { interviewDraftStart, interviewLine } from "@/lib/play/v3/interview-flow";

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function choiceDelta(key: string): number {
  if (key === "ArrowUp" || key.toLowerCase() === "w") return -1;
  if (key === "ArrowDown" || key.toLowerCase() === "s") return 1;
  return 0;
}

/** The student's verdict, with their own words if they added any. */
function answerLine(interview: InterviewView, verdictId: string, text: string | null): string {
  const verdict = interview.verdicts.find((option) => option.id === verdictId)?.text ?? "";
  return text?.trim() ? `${verdict}\n“${text.trim()}”` : verdict;
}

/**
 * The Interview happens over the last stage's map: the interviewer's question, push-back and closing type out in
 * the bottom dialogue box, and the student's answer (verdict, then notes as evidence) pops up above it.
 */
/** "3 notes collected · 2 sources read · 2 decisions made": what the student brings to the debrief. */
export function journeyPills({ notes, documents, decisions }: { notes: number; documents: number; decisions: number }): string[] {
  const count = (n: number, one: string, many: string) => `${n === 0 ? "No" : n} ${n === 1 ? one : many}`;
  return [
    count(notes, "note collected", "notes collected"),
    count(documents, "source read", "sources read"),
    ...(decisions > 0 ? [count(decisions, "decision made", "decisions made")] : []),
  ];
}

export function InterviewScreen({
  interview,
  notes,
  busy,
  send,
  journey = [],
}: {
  interview: InterviewView;
  notes: NoteView[];
  journey?: string[];
  busy: boolean;
  send: (action: Action) => void;
}) {
  const line = interviewLine(interview);
  const typed = useTypewriter(line.text, true);
  const [ackedPushBack, setAckedPushBack] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const previous = line.kind === "pushBack" ? interview.answer : line.kind === "closing" ? interview.response ?? interview.answer : null;
  const sendAnswer = (action: Action) => {
    if (action.type === "interviewAnswer") setPending(answerLine(interview, action.verdictId, action.text ?? null));
    send(action);
  };
  const answering = typed.done && !busy && (line.next === "answer" || ackedPushBack === line.text);

  const advance = () => {
    if (!typed.done) typed.skip();
    else if (line.next === "respond") setAckedPushBack(line.text);
    else if (line.next === "continue" && !busy) send({ type: "continue" });
  };

  useEffect(() => {
    if (answering) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (event.key !== "Enter" && event.key !== " " && event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      advance();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <>
      {answering && line.next !== "continue" ? (
        <AnswerPanel
          key={line.kind}
          interview={interview}
          notes={notes}
          journey={journey}
          responding={line.next === "respond"}
          busy={busy}
          send={sendAnswer}
        />
      ) : null}
      <SpeakerBox
        speaker={interview.interviewer}
        tag={line.kind === "closing" ? "Closing thoughts" : null}
        text={typed.shown}
        before={previous ? answerLine(interview, previous.verdictId, previous.text) : null}
        after={busy && pending && line.next !== "continue" ? pending : null}
        done={typed.done && !answering}
        busy={busy}
        continueLabel={line.next === "continue" ? "See what really happened" : line.next === "respond" ? "Respond" : undefined}
        onAdvance={advance}
      />
    </>
  );
}

function AnswerPanel({
  interview,
  notes,
  journey,
  responding,
  busy,
  send,
}: {
  interview: InterviewView;
  notes: NoteView[];
  responding: boolean;
  journey: string[];
  busy: boolean;
  send: (action: Action) => void;
}) {
  const [start] = useState(() => interviewDraftStart(interview));
  const [step, setStep] = useState<"verdict" | "evidence">("verdict");
  const [verdictIndex, setVerdictIndex] = useState(start.verdictIndex);
  const [evidenceNoteIds, setEvidenceNoteIds] = useState<string[]>(start.evidenceNoteIds.filter((id) => notes.some((note) => note.id === id)));
  const [cursor, setCursor] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const verdict = interview.verdicts[verdictIndex];
  const submitRow = notes.length;

  function toggleNote(noteId: string) {
    setError(null);
    if (evidenceNoteIds.includes(noteId)) {
      setEvidenceNoteIds(evidenceNoteIds.filter((id) => id !== noteId));
    } else if (evidenceNoteIds.length >= MAX_EVIDENCE_NOTES) {
      setError(`Choose no more than ${MAX_EVIDENCE_NOTES} notes.`);
    } else {
      setEvidenceNoteIds([...evidenceNoteIds, noteId]);
    }
  }

  function submit() {
    if (busy || !verdict) return;
    const result = buildInterviewAnswerAction(
      { verdictId: verdict.id, evidenceNoteIds, text },
      { verdictIds: interview.verdicts.map(({ id }) => id), noteIds: notes.map(({ id }) => id) },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    send(result.action);
  }

  function chooseVerdict(index: number) {
    setVerdictIndex(index);
    setCursor(0);
    setStep("evidence");
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && step === "evidence") {
        event.preventDefault();
        setStep("verdict");
        return;
      }
      if (isTextEntryTarget(event.target)) return;
      const delta = choiceDelta(event.key);
      if (step === "verdict") {
        const lettered = event.altKey || event.ctrlKey || event.metaKey ? -1 : choiceKeyIndex(event.key, interview.verdicts.length);
        if (lettered >= 0) {
          event.preventDefault();
          setVerdictIndex(lettered);
        } else if (delta !== 0) {
          event.preventDefault();
          setVerdictIndex((index) => nextChoiceIndex(index, delta, interview.verdicts.length));
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          chooseVerdict(verdictIndex);
        }
        return;
      }
      if (delta !== 0) {
        event.preventDefault();
        setCursor((row) => nextChoiceIndex(row, delta, notes.length + 1));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const note = notes[cursor];
        if (note) toggleNote(note.id);
        else submit();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className={`${pocketRoot} pointer-events-none absolute inset-x-0 top-0 bottom-[9.5rem] z-30 flex flex-col items-center justify-center gap-0 overflow-y-auto p-2 pt-4 sm:bottom-[11rem] sm:p-4`}>
      <div className="relative z-10 -mb-5 w-full max-w-3xl">
        <PocketRibbon>{responding ? "Your response" : "Debrief"}</PocketRibbon>
      </div>
      <section
        aria-label={responding ? "Your response" : "Your answer"}
        className={`${pocketStyles.panel} ${pocketStyles.panelRaised} pointer-events-auto flex max-h-full w-full max-w-3xl flex-col overflow-hidden`}
      >
        <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-9 sm:px-7">
          {journey.length ? (
            <div className="mb-4 border-b-[3px] border-[#d9c7a0] pb-4">
              <PocketTag>Your journey</PocketTag>
              <ul aria-label="Your journey" className="mt-3 flex flex-wrap gap-2">
                {journey.map((item, index) => <li key={item}><PocketPill tone={(["record", "world", "good", "secret"] as const)[index % 4]}>{item}</PocketPill></li>)}
              </ul>
            </div>
          ) : null}
          <PocketTag>{responding ? "Think again" : "The big question"}</PocketTag>
          <h2 className={`${pixelFont.className} mt-2 text-xl font-bold leading-snug sm:text-2xl`}>{interview.question}</h2>
          {responding ? <p className="mt-1 text-sm text-[#6b5f4c]">Keep your answer, or change it now you&apos;ve heard the push-back.</p> : null}

          {step === "verdict" ? (
            <div role="listbox" aria-label="Verdict" className="mt-4 grid gap-2.5">
              {interview.verdicts.map((option, index) => (
                <ChoiceButton
                  key={option.id}
                  index={index}
                  selected={index === verdictIndex}
                  disabled={busy}
                  onHover={() => setVerdictIndex(index)}
                  onSelect={() => chooseVerdict(index)}
                  text={<>
                    {option.text}
                    {responding && option.id === interview.answer?.verdictId ? (
                      <span className="ml-2 inline-block rounded border-2 border-current px-1.5 text-[11px] font-bold uppercase tracking-wide opacity-70">Your answer</span>
                    ) : null}
                  </>}
                />
              ))}
              <p className="text-xs text-[#6b5f4c]">Press A–{"ABCDEF"[Math.max(0, Math.min(interview.verdicts.length, 6) - 1)]} or ↑↓, then Enter.</p>
            </div>
          ) : (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <PocketPill tone="ink">{CHOICE_KEYS[verdictIndex]}</PocketPill>
                <span className="font-bold">{verdict?.text}</span>
                <button type="button" onClick={() => setStep("verdict")} className="ml-auto min-h-9 rounded-lg px-2 text-sm font-bold underline">Change</button>
              </p>
              <label htmlFor="interview-reasoning" className={`${pixelFont.className} text-sm font-bold uppercase tracking-[0.08em] text-[#a8442a]`}>Your answer, in your own words</label>
              <textarea
                id="interview-reasoning"
                value={text}
                maxLength={MAX_INTERVIEW_TEXT_LENGTH}
                rows={3}
                onChange={(event) => setText(event.target.value)}
                placeholder="Explain your answer (optional)"
                aria-label="Your reasoning (optional)"
                className={`${pixelFont.className} min-h-24 w-full resize-y rounded-lg border-[3px] border-[#1f2433] bg-white px-3 py-2 text-base outline-none focus:ring-4 focus:ring-[#ffe66d]`}
              />
              <fieldset className="grid gap-2">
                <legend className={`${pixelFont.className} mb-1 text-sm font-bold uppercase tracking-[0.08em] text-[#a8442a]`}>
                  Evidence <span className="font-sans text-xs font-semibold normal-case tracking-normal text-[#6b5f4c]">({evidenceNoteIds.length}/{MAX_EVIDENCE_NOTES} notes, optional)</span>
                </legend>
                {notes.length === 0 ? (
                  <p className="text-sm text-[#6b5f4c]">You didn&apos;t write any notes.</p>
                ) : notes.map((note, index) => (
                  <ChoiceButton
                    key={note.id}
                    role="checkbox"
                    index={index}
                    checked={evidenceNoteIds.includes(note.id)}
                    selected={index === cursor}
                    disabled={busy}
                    onHover={() => setCursor(index)}
                    onSelect={() => toggleNote(note.id)}
                    text={<span className="font-sans text-sm font-medium sm:text-base">{note.text}</span>}
                  />
                ))}
              </fieldset>
              {error ? <p role="alert" className="text-sm font-bold text-[#c2412d]">{error}</p> : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  onMouseEnter={() => setCursor(submitRow)}
                  className={`${pixelFont.className} min-h-12 rounded-lg border-[3px] border-[#1f2433] bg-[#d85f35] px-5 text-lg font-bold text-white shadow-[0_4px_0_#1f2433] hover:bg-[#c04f28] active:translate-y-[2px] active:shadow-none disabled:opacity-50 ${cursor === submitRow ? "outline outline-4 outline-offset-2 outline-[#ffe66d]" : ""}`}
                >
                  {responding ? "Give my response" : "Submit answer"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
