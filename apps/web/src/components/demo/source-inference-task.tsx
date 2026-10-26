"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EXEMPLARS,
  LEVELS,
  MAX_ATTEMPTS,
  SOURCE_TASK,
  SOURCE_TASK_MAX_CHARS,
  emptySourceTask,
  isSubmitted,
  restoreSourceTask,
  type Attempt,
  type Grade,
  type SourceTaskRecord,
} from "@/lib/demo/inference-task";
import styles from "./source-inference-task.module.css";

const FLAT_SOURCE = SOURCE_TASK.text.join(" ").replace(/\s+/g, " ");

/** A drag can stop mid-word; widen the selection to whole words of the source. Null if it is not from Source D. */
function wholeWords(text: string): string | null {
  const at = FLAT_SOURCE.indexOf(text);
  if (at < 0) return null;
  let start = at;
  let end = at + text.length;
  while (start > 0 && /\S/.test(FLAT_SOURCE[start - 1]!)) start -= 1;
  while (end < FLAT_SOURCE.length && /[\p{L}\p{N}’'-]/u.test(FLAT_SOURCE[end]!)) end += 1;
  return FLAT_SOURCE.slice(start, end).trim();
}

/** Standalone demo only. Saved under the demo's own browser key; never sent to the v2/v3 stores. */
export function SourceInferenceTask({
  storageKey,
  briefing,
  hasNote = false,
  onSubmitted,
  showSource = true,
}: {
  storageKey: string;
  /** In-game framing shown above the question. */
  briefing?: ReactNode;
  /** Whether the chapter's evidence note already exists. */
  hasNote?: boolean;
  /** Called once an answer is submitted, to save the chapter's evidence note. */
  onSubmitted?: (settled: (ok: boolean) => void) => void;
  /** Off inside the game's document reader, which already shows Source D's text. */
  showSource?: boolean;
}) {
  const [record, setRecord] = useState<SourceTaskRecord>(emptySourceTask);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [noteFailed, setNoteFailed] = useState(false);
  const notifying = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      setRecord(restoreSourceTask(localStorage.getItem(storageKey)));
    } catch {
      setSaveError(true);
    }
    setLoaded(true);
  }, [storageKey]);

  // Completes the chapter goal; retried on reopen if an earlier save was interrupted.
  function notify() {
    if (!onSubmitted || hasNote || notifying.current) return;
    notifying.current = true;
    onSubmitted((ok) => {
      notifying.current = false;
      setNoteFailed(!ok);
    });
  }
  useEffect(() => {
    if (loaded && isSubmitted(record)) notify();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the saved record first loads
  }, [loaded]);

  function save(next: SourceTaskRecord) {
    setRecord(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setSaveError(true);
    }
  }

  const attempts = record.attempts;
  const finished = attempts.length >= MAX_ATTEMPTS;
  const latest = attempts.at(-1);
  const revising = attempts.length === 1;

  // Words highlighted anywhere on the page count, as long as they come from Source D
  // (in the game this is the document reader's text, outside this component).
  // Capture phase: the reader would otherwise turn the highlight into a note and
  // clear it. For Source D a highlight means "quote this"; the note is earned by
  // submitting the answer, so the reader's handler is skipped for these words.
  useEffect(() => {
    const capture = (event: Event) => {
      const text = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!text) return;
      const words = text.split(" ").length >= 2 ? wholeWords(text) : null;
      setSelection(words ?? "");
      if (words && event.type !== "keyup") event.stopPropagation();
    };
    for (const type of ["mouseup", "keyup", "touchend"]) window.addEventListener(type, capture, true);
    return () => {
      for (const type of ["mouseup", "keyup", "touchend"]) window.removeEventListener(type, capture, true);
    };
  }, []);

  function insertQuote() {
    if (!selection) return;
    const el = box.current;
    const quoted = `“${selection}”`;
    const start = el?.selectionStart ?? record.draft.length;
    const end = el?.selectionEnd ?? record.draft.length;
    const before = record.draft.slice(0, start);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    const draft = `${before}${spacer}${quoted}${record.draft.slice(end)}`.slice(0, SOURCE_TASK_MAX_CHARS);
    save({ ...record, draft });
    setSelection("");
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => {
      el?.focus();
      const caret = before.length + spacer.length + quoted.length;
      el?.setSelectionRange(caret, caret);
    });
  }

  async function submit() {
    const answer = record.draft.trim();
    if (!answer || busy || finished) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/demo/lim-bo-seng/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const body = (await response.json()) as { mode?: string; grade?: Grade; message?: string; error?: string };
      if (body.mode === "live" && body.grade) {
        const attempt: Attempt = { answer, submittedAt: new Date().toISOString(), grade: body.grade };
        save({ ...record, draft: attempts.length + 1 < MAX_ATTEMPTS ? answer : "", attempts: [...attempts, attempt] });
        setUnavailable(false);
        notify();
      } else {
        setUnavailable(body.mode === "unavailable");
        setNotice(body.message ?? body.error ?? "Marking is unavailable right now. Your answer is saved.");
      }
    } catch {
      setUnavailable(true);
      setNotice("Could not reach the marker. Your answer is saved; try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveForTeacher() {
    const answer = record.draft.trim();
    if (!answer) return;
    save({ ...record, unmarked: { answer, submittedAt: new Date().toISOString() } });
    setNotice(null);
    notify();
  }

  if (!loaded) return <p>Loading the source task…</p>;
  return (
    <div className={styles.task}>
      {briefing}
      <p className={styles.eyebrow}>Source skills · inference and explanation · {SOURCE_TASK.marks} marks</p>
      <h3 className={styles.question}>{SOURCE_TASK.question}</h3>

      {showSource ? (
        <figure className={styles.source} aria-label={SOURCE_TASK.label}>
          <figcaption>
            <strong>{SOURCE_TASK.label}:</strong> {SOURCE_TASK.provenance}
          </figcaption>
          {SOURCE_TASK.text.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
          <p className={styles.small}>{SOURCE_TASK.sourceNote}</p>
        </figure>
      ) : (
        <p className={styles.small}>
          <strong>{SOURCE_TASK.label}</strong> is the newspaper text above. {SOURCE_TASK.sourceNote}
        </p>
      )}

      {latest && <Feedback attempt={latest} final={finished} index={attempts.length} />}
      {!finished && (
        <>
          <p className={styles.tip}>
            Highlight words in {showSource ? "Source D" : "the newspaper above"} to quote them as evidence, then explain how they support your inference.
          </p>
          <div className={styles.quoteBar} aria-live="polite">
            {selection ? (
              <button type="button" className={styles.secondary} onClick={insertQuote}>
                Quote “{selection.length > 60 ? `${selection.slice(0, 60)}…` : selection}”
              </button>
            ) : (
              <span className={styles.small}>No source words selected.</span>
            )}
          </div>
          <label className={styles.label} htmlFor="source-task-answer">
            {revising ? "Revise your answer using the feedback" : "Your answer"}
          </label>
          <textarea
            id="source-task-answer"
            ref={box}
            className={styles.answer}
            value={record.draft}
            maxLength={SOURCE_TASK_MAX_CHARS}
            rows={9}
            onChange={(e) => save({ ...record, draft: e.target.value })}
            placeholder="I can infer that…"
          />
          <div className={styles.actions}>
            <span className={styles.small}>
              {record.draft.trim() ? record.draft.trim().split(/\s+/).length : 0} words ·{" "}
              {MAX_ATTEMPTS - attempts.length} submission{MAX_ATTEMPTS - attempts.length === 1 ? "" : "s"} left
            </span>
            <button type="button" className={styles.primary} disabled={!record.draft.trim() || busy} onClick={submit}>
              {busy ? "Marking…" : revising ? "Submit revised answer" : "Submit for feedback"}
            </button>
          </div>
          {notice && (
            <div role="status" className={styles.notice}>
              <p>{notice}</p>
              {unavailable && !record.unmarked && attempts.length === 0 && record.draft.trim() && (
                <button type="button" className={styles.secondary} onClick={saveForTeacher}>
                  Save my answer for my teacher (no AI feedback)
                </button>
              )}
            </div>
          )}
          {record.unmarked && attempts.length === 0 && (
            <p className={styles.notice}>
              Your answer is saved for your teacher to mark. You can still submit it for AI feedback when marking
              is available.
            </p>
          )}
        </>
      )}

      {finished && attempts.length > 1 && (
        <section className={styles.progress} aria-label="Your progress">
          <h4>Your progress</h4>
          <p>
            {attempts.map((a, i) => `Attempt ${i + 1}: L${a.grade.level} · ${a.grade.mark}/${SOURCE_TASK.marks}`).join("  →  ")}
          </p>
          <details>
            <summary>Your first answer</summary>
            <p className={styles.written}>{attempts[0]!.answer}</p>
          </details>
          <details>
            <summary>See a full-mark answer (draft for teacher review)</summary>
            <p className={styles.written}>{EXEMPLARS.at(-1)!.answer}</p>
            <p className={styles.small}>{EXEMPLARS.at(-1)!.why}</p>
          </details>
        </section>
      )}

      <details className={styles.scheme}>
        <summary>How answers are marked</summary>
        <table>
          <tbody>
            {LEVELS.map((l) => (
              <tr key={l.level}>
                <th scope="row">
                  L{l.level}
                  <br />
                  {l.range}m
                </th>
                <td>
                  <strong>{l.descriptor}</strong>
                  <br />
                  {l.marks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className={styles.small}>
        Your answer is sent to the configured AI provider for marking and saved in this browser. The mark is
        AI-suggested; your teacher can confirm or change it in your learning report.
      </p>
      {noteFailed && (
        <p role="alert" className={styles.notice}>
          Your answer is saved, but the evidence note could not be added. Close and reopen the newspaper to try
          again.
        </p>
      )}
      {saveError && (
        <p role="status" className={styles.notice}>
          Browser saving is unavailable. Download your learning report before leaving.
        </p>
      )}
    </div>
  );
}

function Feedback({ attempt, final, index }: { attempt: Attempt; final: boolean; index: number }) {
  const { grade } = attempt;
  return (
    <section className={styles.feedback} aria-live="polite" aria-label={`Feedback on attempt ${index}`}>
      <div className={styles.markRow}>
        <span className={styles.mark}>
          {grade.mark}/{SOURCE_TASK.marks}
        </span>
        <span>
          <strong>Level {grade.level}</strong> · AI-suggested mark for attempt {index}
          <br />
          <span className={styles.small}>{grade.reasons.at(-1) ?? LEVELS.find((l) => l.level === grade.level)?.descriptor}</span>
        </span>
      </div>
      {grade.inference && (
        <p>
          <strong>Your inference:</strong> {grade.inference}
          {grade.inferencePrecise ? " (precise)" : " (valid, but not yet precise)"}
        </p>
      )}
      <div>
        <strong>Evidence you quoted</strong>
        {grade.quotes.length ? (
          <ul className={styles.quotes}>
            {grade.quotes.map((q) => (
              <li key={q.text} data-found={q.found}>
                {q.found ? "✓" : "✗"} “{q.text}”{q.found ? "" : " — not found in Source D"}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.small}>No quotation from Source D was found in this answer.</p>
        )}
      </div>
      <p>
        <strong>What you did well:</strong> {grade.strength}
      </p>
      {grade.mark < SOURCE_TASK.marks && (
        <p className={styles.next}>
          <strong>{final ? "To improve next time:" : "Your next step:"}</strong> {grade.nextStep}
        </p>
      )}
      <details>
        <summary>Why this mark</summary>
        <ul>
          {grade.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
