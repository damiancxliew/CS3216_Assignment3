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
export function InterviewScreen({
  interview,
  notes,
  busy,
  send,
}: {
  interview: InterviewView;
  notes: NoteView[];
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
  responding,
  busy,
  send,
}: {
  interview: InterviewView;
  notes: NoteView[];
  responding: boolean;
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
        if (delta !== 0) {
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

  const rowClass = (selected: boolean) =>
    `flex min-h-10 w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left leading-snug transition disabled:cursor-not-allowed disabled:opacity-60 ${
      selected ? "bg-[#e7edff] text-[#3659cf]" : "text-[#1f2433] hover:bg-[#1f2433]/5"
    }`;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[9.5rem] z-30 flex items-center justify-center p-2 sm:bottom-[11rem] sm:p-4">
    <section
      aria-label={responding ? "Your response" : "Your answer"}
      className="pointer-events-auto flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] font-sans text-[#1f2433] shadow-[4px_4px_0_#1f2433]"
    >
      <header className="flex items-center justify-between gap-3 border-b-4 border-[#1f2433] bg-[#1f2433] px-4 py-2 text-[#fffaf0]">
        <h2 className={`${pixelFont.className} text-base font-bold`}>{responding ? "Your response" : "Your answer"}</h2>
        <span className="text-xs font-semibold text-[#e9dcc0]">
          {step === "verdict" ? "↑↓ to choose · Enter to pick" : `${evidenceNoteIds.length}/${MAX_EVIDENCE_NOTES} notes · Esc to go back`}
        </span>
      </header>

      {step === "verdict" ? (
        <div role="listbox" aria-label="Verdict" className="min-h-0 overflow-y-auto p-2">
          {responding ? (
            <p className="px-2 pb-1 text-sm text-[#1f2433]/75">Keep your answer, or change it now you&apos;ve heard the push-back.</p>
          ) : null}
          {interview.verdicts.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={index === verdictIndex}
              disabled={busy}
              onMouseEnter={() => setVerdictIndex(index)}
              onClick={() => chooseVerdict(index)}
              className={rowClass(index === verdictIndex)}
            >
              <span aria-hidden className="w-4 shrink-0 text-sm font-black text-[#e36b33]">{index === verdictIndex ? "▶" : ""}</span>
              <span className="text-[15px] font-semibold sm:text-base">
                {option.text}
                {responding && option.id === interview.answer?.verdictId ? (
                  <span className="ml-2 inline-block rounded border border-current px-1.5 text-[11px] font-bold uppercase tracking-wide opacity-70">Your answer</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="border-b-2 border-[#1f2433]/15 px-4 py-2 text-sm">
            <span className="font-black">{verdict?.text}</span>
            <span className="block text-[#1f2433]/70">Back it up with notes from your notebook (optional).</span>
          </p>
          <div className="min-h-0 overflow-y-auto p-2">
            {notes.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[#1f2433]/70">You didn&apos;t write any notes.</p>
            ) : (
              notes.map((note, index) => {
                const checked = evidenceNoteIds.includes(note.id);
                return (
                  <button
                    key={note.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={busy}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => toggleNote(note.id)}
                    className={rowClass(index === cursor)}
                  >
                    <span aria-hidden className="w-4 shrink-0 text-sm font-black text-[#e36b33]">{index === cursor ? "▶" : ""}</span>
                    <span aria-hidden className="mt-1 grid size-4 shrink-0 place-items-center rounded border-2 border-[#1f2433] text-[10px] leading-none">
                      {checked ? "✓" : ""}
                    </span>
                    <span className="text-sm font-medium sm:text-base">{note.text}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="grid gap-2 border-t-2 border-[#1f2433]/15 p-3">
            <input
              value={text}
              maxLength={MAX_INTERVIEW_TEXT_LENGTH}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a line in your own words (optional)"
              aria-label="Your reasoning (optional)"
              className="min-h-10 w-full rounded-lg border-2 border-[#1f2433] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#ffd65a]"
            />
            {error ? <p role="alert" className="text-sm font-bold text-signal">{error}</p> : null}
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setStep("verdict")} className="min-h-10 rounded-lg px-3 text-sm font-bold underline">
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                onMouseEnter={() => setCursor(submitRow)}
                className={`min-h-10 rounded-lg border-2 border-[#1f2433] px-4 text-sm font-black shadow-[2px_2px_0_#1f2433] disabled:opacity-50 ${
                  cursor === submitRow ? "bg-[#e7edff] text-[#3659cf]" : "bg-white"
                }`}
              >
                {cursor === submitRow ? "▶ " : ""}{responding ? "Give my response" : "Give my answer"}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
    </div>
  );
}
