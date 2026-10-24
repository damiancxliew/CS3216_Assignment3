"use client";
import { useEffect, useRef, useState } from "react";
import {
  EXEMPLARS,
  LEVELS,
  MAX_ATTEMPTS,
  SOURCE_TASK,
  SOURCE_TASK_MAX_CHARS,
  emptySourceTask,
  restoreSourceTask,
  type Attempt,
  type Grade,
  type SourceTaskRecord,
} from "@/lib/demo/inference-task";
import styles from "./source-inference-task.module.css";

const FLAT_SOURCE = SOURCE_TASK.text.join(" ").replace(/\s+/g, " ");

/** A drag can stop mid-word; widen the selection to whole words of the source. */
function wholeWords(text: string): string {
  const at = FLAT_SOURCE.indexOf(text);
  if (at < 0) return text;
  let start = at;
  let end = at + text.length;
  while (start > 0 && /\S/.test(FLAT_SOURCE[start - 1]!)) start -= 1;
  while (end < FLAT_SOURCE.length && /[\p{L}\p{N}’'-]/u.test(FLAT_SOURCE[end]!)) end += 1;
  return FLAT_SOURCE.slice(start, end).trim();
}

/** Standalone demo only. Saved under the demo's own browser key; never sent to the v2/v3 stores. */
export function SourceInferenceTask({ storageKey }: { storageKey: string }) {
  const [record, setRecord] = useState<SourceTaskRecord>(emptySourceTask);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const [saveError, setSaveError] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setRecord(restoreSourceTask(localStorage.getItem(storageKey)));
    } catch {
      setSaveError(true);
    }
    setLoaded(true);
  }, [storageKey]);

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

  function captureSelection() {
    const picked = window.getSelection();
    const text = picked?.toString().replace(/\s+/g, " ").trim() ?? "";
    const inside = picked?.anchorNode && sourceRef.current?.contains(picked.anchorNode);
    setSelection(inside && text.split(" ").length >= 2 ? wholeWords(text) : "");
  }

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
        save({ draft: attempts.length + 1 < MAX_ATTEMPTS ? answer : "", attempts: [...attempts, attempt] });
      } else {
        setNotice(body.message ?? body.error ?? "Marking is unavailable right now. Your answer is saved.");
      }
    } catch {
      setNotice("Could not reach the marker. Your answer is saved; try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p>Loading the source task…</p>;
  return (
    <div className={styles.task}>
      <p className={styles.eyebrow}>Source skills · inference and explanation · {SOURCE_TASK.marks} marks</p>
      <h3 className={styles.question}>{SOURCE_TASK.question}</h3>

      <figure className={styles.source} aria-label={SOURCE_TASK.label}>
        <figcaption>
          <strong>{SOURCE_TASK.label}:</strong> {SOURCE_TASK.provenance}
        </figcaption>
        <div ref={sourceRef} onMouseUp={captureSelection} onKeyUp={captureSelection} onTouchEnd={captureSelection}>
          {SOURCE_TASK.text.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
        </div>
        <p className={styles.small}>{SOURCE_TASK.sourceNote}</p>
      </figure>

      {latest && <Feedback attempt={latest} final={finished} index={attempts.length} />}
      {!finished && (
        <>
          <p className={styles.tip}>
            Highlight words in Source D to quote them as evidence, then explain how they support your inference.
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
            <p role="status" className={styles.notice}>
              {notice}
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
