"use client";

import type { DocumentView } from "@adventure/play-contract";
import { sourceSentenceSpans } from "@adventure/spec-v3";
import { useId, useState } from "react";
import styles from "./reading-check.module.css";

export type SupportingSelection = { start: number; end: number };
export type ReadingCheckSubmission = SupportingSelection & {
  questionId: string;
  choiceId: string;
  recovery?: boolean;
};

/** These are source text choices, never accepted answers. Preserve the original offsets. */
export function sourceSentenceSelections(body: string) {
  return sourceSentenceSpans(body).map((span) => ({ ...span, text: body.slice(span.start, span.end) }));
}

function SupportingSentences({ body, selection, onSelect, disabled }: {
  body: string;
  selection: SupportingSelection | null;
  onSelect: (selection: SupportingSelection | null) => void;
  disabled: boolean;
}) {
  return <details className={styles.sentencePicker}>
    <summary>Choose supporting sentences without dragging</summary>
    <fieldset disabled={disabled}>
      <legend>Choose a sentence, or a short run of neighbouring sentences.</legend>
      {sourceSentenceSelections(body).map((sentence) => <label key={sentence.start}>
        <input
          type="checkbox"
          checked={Boolean(selection && sentence.start >= selection.start && sentence.end <= selection.end)}
          onChange={(event) => {
            if (event.target.checked) onSelect(selection
              ? { start: Math.min(selection.start, sentence.start), end: Math.max(selection.end, sentence.end) }
              : { start: sentence.start, end: sentence.end });
            else onSelect(null);
          }}
        />
        <span>{sentence.text}</span>
      </label>)}
    </fieldset>
    {selection ? <button type="button" disabled={disabled} onClick={() => onSelect(null)}>Clear selection</button> : null}
  </details>;
}

export function ReadingCheck({ document, selection, onSelect, onSubmit, onSavePassage, busy = false }: {
  document: DocumentView;
  selection: SupportingSelection | null;
  onSelect: (selection: SupportingSelection | null) => void;
  onSubmit?: (submission: ReadingCheckSubmission, onSettled: (succeeded: boolean) => void) => void;
  onSavePassage?: (start: number, end: number, onSettled: (succeeded: boolean) => void) => void;
  busy?: boolean;
}) {
  const check = document.readingCheck!;
  const recovery = check.status === "needsReview";
  const question = recovery ? check.recovery : check.question;
  const [choiceId, setChoiceId] = useState("");
  const [sending, setSending] = useState(false);
  const [transportError, setTransportError] = useState(false);
  const name = useId();
  const disabled = busy || sending || !onSubmit;

  if (check.status === "passed") return (
    <section data-reading-check="" tabIndex={-1} className={styles.passed} aria-label="Reading check complete">
      <div role="status"><p><strong>Reading check complete.</strong> This evidence counts towards your preparation.</p>
        {check.explanation ? <p>{check.explanation}</p> : null}
      </div>
      {onSavePassage ? <>
        <SupportingSentences body={document.body} selection={selection} onSelect={onSelect} disabled={busy || sending} />
        {selection ? <blockquote className={styles.selection}>{document.body.slice(selection.start, selection.end)}</blockquote> : null}
        <button type="button" className={styles.submit} disabled={busy || sending || !selection} onClick={() => {
          if (!selection || busy || sending) return;
          setSending(true);
          setTransportError(false);
          onSavePassage(selection.start, selection.end, (succeeded) => { setSending(false); setTransportError(!succeeded); });
        }}>{sending ? "Saving passage…" : "Save passage as a note"}</button>
        {transportError ? <p role="alert">Your passage could not be saved. Try again.</p> : null}
      </> : null}
    </section>
  );

  return (
    <section data-reading-check="" tabIndex={-1} className={styles.check} aria-label={recovery ? "Review the evidence" : "Reading check"}>
      {recovery ? (
        <div className={styles.review} role="status">
          <h3>Review the evidence before trying again</h3>
          <p>{check.feedback ?? "That answer was not supported. Complete the correction below or investigate another relevant source first."}</p>
        </div>
      ) : (
        <p className={styles.instructions}>Choose an answer, then highlight the sentence or sentences that support it. A wrong answer needs a correction before you can try again.</p>
      )}
      {question ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!choiceId || !selection || disabled) return;
          setSending(true);
          setTransportError(false);
          onSubmit?.({ questionId: question.id, choiceId, ...selection, ...(recovery ? { recovery: true } : {}) }, (succeeded) => {
            setSending(false);
            setTransportError(!succeeded);
          });
        }}>
          <fieldset disabled={disabled} className={styles.options}>
            <legend>{question.prompt}</legend>
            {question.options.map((option) => (
              <label key={option.id}>
                <input type="radio" name={name} value={option.id} checked={choiceId === option.id} onChange={() => setChoiceId(option.id)} />
                <span>{option.text}</span>
              </label>
            ))}
          </fieldset>
          <div className={styles.selection} aria-live="polite">
            <p><strong>Supporting passage</strong></p>
            {selection ? <blockquote>{document.body.slice(selection.start, selection.end)}</blockquote> : <p>Highlight a short passage in the source above, or choose sentences below.</p>}
          </div>
          <SupportingSentences body={document.body} selection={selection} onSelect={onSelect} disabled={disabled} />
          <button type="submit" className={styles.submit} disabled={disabled || !choiceId || !selection}>
            {sending ? "Checking your answer…" : recovery ? "Submit correction" : "Submit answer and evidence"}
          </button>
          {transportError ? <p role="alert">Your answer could not be saved. Try submitting again.</p> : null}
        </form>
      ) : <p>Investigate another relevant source, then return to this scroll.</p>}
    </section>
  );
}
