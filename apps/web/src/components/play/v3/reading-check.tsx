"use client";

import type { DocumentView } from "@adventure/play-contract";
import { useId, useRef, useState } from "react";
import styles from "./reading-check.module.css";

export type SupportingSelection = { start: number; end: number };
export type ReadingCheckSubmission = SupportingSelection & {
  questionId: string;
  choiceId: string;
  recovery?: boolean;
};

export function ReadingCheck({ document, selection, onSelect, onSubmit, busy = false }: {
  document: DocumentView;
  selection: SupportingSelection | null;
  onSelect: (selection: SupportingSelection | null) => void;
  onSubmit?: (submission: ReadingCheckSubmission, onSettled: (succeeded: boolean) => void) => void;
  busy?: boolean;
}) {
  const check = document.readingCheck!;
  const recovery = check.status === "needsReview";
  const question = recovery ? check.recovery : check.question;
  const [choiceId, setChoiceId] = useState("");
  const [sending, setSending] = useState(false);
  const [transportError, setTransportError] = useState(false);
  const name = useId();
  const review = useRef<HTMLDivElement>(null);
  const disabled = busy || sending || !onSubmit;

  if (check.status === "passed") return (
    <section data-reading-check="" tabIndex={-1} className={styles.passed} aria-label="Reading check complete">
      <div role="status"><p><strong>Reading check complete.</strong> This evidence counts towards your preparation.</p>
        {check.explanation ? <p>{check.explanation}</p> : null}
      </div>
    </section>
  );

  return (
    <section data-reading-check="" tabIndex={-1} className={styles.check} aria-label={recovery ? "Review the evidence" : "Reading check"}>
      {recovery ? (
        <div ref={review} tabIndex={-1} className={styles.review} role="alert">
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
            if (succeeded && recovery) {
              setChoiceId("");
              onSelect(null);
              review.current?.scrollIntoView({ block: "nearest" });
              review.current?.focus({ preventScroll: true });
            }
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
            {selection ? <blockquote>{document.body.slice(selection.start, selection.end)}</blockquote> : <p>Highlight a short passage in the source above.</p>}
          </div>
          {selection ? <button type="button" className={styles.clear} disabled={disabled} onClick={() => onSelect(null)}>Clear highlight</button> : null}
          <button type="submit" className={styles.submit} disabled={disabled || !choiceId || !selection}>
            {sending ? "Checking your answer…" : recovery ? "Submit correction" : "Submit answer and evidence"}
          </button>
          {transportError ? <p role="alert">Your answer could not be saved. Close and reopen the source, then try again.</p> : null}
        </form>
      ) : <p>Investigate another relevant source, then return to this scroll.</p>}
    </section>
  );
}
