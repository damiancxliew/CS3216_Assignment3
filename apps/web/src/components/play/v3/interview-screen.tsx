"use client";

import {
  MAX_EVIDENCE_NOTES,
  MAX_INTERVIEW_TEXT_LENGTH,
  type Action,
  type InterviewView,
  type NoteView,
} from "@adventure/play-contract";
import { useEffect, useState, type FormEvent } from "react";

import { buildInterviewAnswerAction } from "@/lib/play/v3/interview-form";

type InterviewAnswer = NonNullable<InterviewView["answer"]>;

function AnswerSummary({
  heading,
  answer,
  interview,
  notes,
}: {
  heading: string;
  answer: InterviewAnswer;
  interview: InterviewView;
  notes: NoteView[];
}) {
  const verdict = interview.verdicts.find((item) => item.id === answer.verdictId)?.text;
  const evidence = answer.evidenceNoteIds.map((id) => notes.find((note) => note.id === id)?.text).filter(Boolean);

  return (
    <section className="rounded-xl border border-line bg-paper p-4">
      <h3 className="font-black text-ink">{heading}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink"><strong>Verdict:</strong> {verdict ?? "A verdict was selected."}</p>
      {evidence.length ? (
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-relaxed text-ink">
          {evidence.map((text, index) => <li key={`${text}-${index}`}>{text}</li>)}
        </ul>
      ) : null}
      {answer.text ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer.text}</p> : null}
    </section>
  );
}

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
  const [verdictId, setVerdictId] = useState(interview.answer?.verdictId ?? "");
  const [evidenceNoteIds, setEvidenceNoteIds] = useState<string[]>(interview.answer?.evidenceNoteIds ?? []);
  const [text, setText] = useState(interview.answer?.text ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!interview.answer) return;
    setVerdictId(interview.answer.verdictId);
    setEvidenceNoteIds(interview.answer.evidenceNoteIds);
    setText(interview.answer.text ?? "");
  }, [interview.answer]);

  function toggleEvidence(noteId: string, checked: boolean) {
    setEvidenceNoteIds((current) => {
      if (!checked) return current.filter((id) => id !== noteId);
      if (current.includes(noteId) || current.length >= MAX_EVIDENCE_NOTES) return current;
      return [...current, noteId];
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second answer is legal (it becomes the response to the push-back), so a double click must not send it.
    if (busy) return;
    const result = buildInterviewAnswerAction(
      { verdictId, evidenceNoteIds, text },
      { verdictIds: interview.verdicts.map((verdict) => verdict.id), noteIds: notes.map((note) => note.id) },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    send(result.action);
  }

  const responding = interview.answer !== null && interview.pushBack !== null;

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-5 px-4 py-8 sm:px-8 sm:py-12">
      <header className="rounded-3xl border-2 border-ink bg-record-wash p-6 shadow-[0_5px_0_var(--ink)] sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-record">The Interview</p>
        <h2 className="mt-2 text-3xl font-black text-ink sm:text-4xl">{interview.interviewer}</h2>
        <p className="mt-5 text-lg font-bold leading-relaxed text-ink">{interview.question}</p>
      </header>

      {interview.answer ? <AnswerSummary heading="Your answer" answer={interview.answer} interview={interview} notes={notes} /> : null}
      {interview.pushBack ? (
        <section className="rounded-2xl border-l-4 border-signal bg-signal-wash p-5">
          <h3 className="font-black text-signal">The interviewer pushes back</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink">{interview.pushBack}</p>
        </section>
      ) : null}
      {interview.response ? <AnswerSummary heading="Your response" answer={interview.response} interview={interview} notes={notes} /> : null}
      {interview.closing ? (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-black text-ink">Closing thoughts</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink">{interview.closing}</p>
        </section>
      ) : null}

      {interview.closed ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ type: "continue" })}
          className="min-h-12 justify-self-start rounded-xl border-2 border-ink bg-world px-6 py-3 font-black text-white shadow-[0_4px_0_var(--ink)] hover:brightness-110 disabled:opacity-50"
        >
          Continue
        </button>
      ) : (
        <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h3 className="text-xl font-black text-ink">{responding ? "Your response" : "What do you think?"}</h3>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-black text-ink">Choose your verdict</legend>
            {interview.verdicts.map((verdict) => (
              <label key={verdict.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper p-3 text-sm font-semibold leading-relaxed text-ink">
                <input
                  type="radio"
                  name="interview-verdict"
                  value={verdict.id}
                  checked={verdictId === verdict.id}
                  disabled={busy}
                  onChange={() => setVerdictId(verdict.id)}
                  className="mt-1 size-4 accent-[var(--world)]"
                />
                <span>{verdict.text}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-black text-ink">
              Which of your notes support this? <span className="font-semibold text-muted">({evidenceNoteIds.length}/{MAX_EVIDENCE_NOTES})</span>
            </legend>
            {notes.length ? notes.map((note) => {
              const checked = evidenceNoteIds.includes(note.id);
              return (
                <label key={note.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed text-ink">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || (!checked && evidenceNoteIds.length >= MAX_EVIDENCE_NOTES)}
                    onChange={(event) => toggleEvidence(note.id, event.target.checked)}
                    className="mt-1 size-4 accent-[var(--world)]"
                  />
                  <span>{note.text}</span>
                </label>
              );
            }) : <p className="text-sm text-muted">You have no notes to use as evidence.</p>}
          </fieldset>

          <label className="grid gap-2 text-sm font-black text-ink" htmlFor="v3-interview-text">
            Optional explanation
            <textarea
              id="v3-interview-text"
              value={text}
              maxLength={MAX_INTERVIEW_TEXT_LENGTH}
              rows={4}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              className="w-full resize-y rounded-xl border border-line-strong bg-paper p-3 text-sm font-normal leading-relaxed text-ink"
            />
            <span className="text-right text-xs font-normal text-muted">{text.length}/{MAX_INTERVIEW_TEXT_LENGTH}</span>
          </label>
          {error ? <p role="alert" className="text-sm font-bold text-signal">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 justify-self-start rounded-xl border-2 border-ink bg-world px-6 py-3 font-black text-white shadow-[0_4px_0_var(--ink)] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving…" : responding ? "Send your response" : "Submit your answer"}
          </button>
        </form>
      )}
    </main>
  );
}
