"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { sourceQuestions } from "@/lib/demo/source-questions";
import styles from "./source-question.module.css";

const Rewards = createContext<{
  solved: string[];
  unlock: (id: string) => void;
}>({ solved: [], unlock: () => {} });

export function SourceRewards({ storageKey, children }: {
  storageKey: string;
  children: ReactNode;
}) {
  const [solved, setSolved] = useState<string[]>([]);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setSolved(Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string" && Object.hasOwn(sourceQuestions, id))
        : []);
    } catch {
      setSaveError(true);
    }
  }, [storageKey]);

  function unlock(id: string) {
    const next = [...new Set([...solved, id])];
    setSolved(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setSaveError(true);
    }
  }
  return (
    <Rewards.Provider value={{ solved, unlock }}>
      {children}
      {saveError && (
        <p className={styles.saveError} role="status">
          Source hints are available for this visit, but browser saving is unavailable.
        </p>
      )}
    </Rewards.Provider>
  );
}

type QuestionProps = {
  id: string;
  onReward?: (settled: (ok: boolean) => void) => void;
  hasNote?: boolean;
};
export function SourceQuestion(props: QuestionProps) {
  // Reset answer feedback when navigating between sources in the same reader.
  return <Question key={props.id} {...props} />;
}
function Question({ id, onReward, hasNote = false }: QuestionProps) {
  const quiz = sourceQuestions[id];
  const { solved, unlock } = useContext(Rewards);
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!quiz) return null;
  const earned = solved.includes(id);

  function saveNote() {
    if (!onReward || hasNote || saving) return;
    setSaving(true);
    setFailed(false);
    onReward((ok) => {
      setSaving(false);
      setSaved(ok);
      setFailed(!ok);
    });
  }
  function check() {
    if (choice === null) return;
    setChecked(true);
    if (choice === quiz.answer) {
      unlock(id);
      saveNote();
    }
  }
  return (
    <section className={styles.question} aria-label="Source question">
      <p className={styles.eyebrow}>Read · reason · unlock a hint</p>
      <fieldset disabled={earned || saving}>
        <legend>{quiz.question}</legend>
        {quiz.options.map((option, i) => (
          <label key={option} className={styles.option} data-selected={(earned ? quiz.answer : choice) === i}>
            <input
              type="radio"
              name={`source-${id}`}
              checked={(earned ? quiz.answer : choice) === i}
              onChange={() => { setChoice(i); setChecked(false); }}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      {!earned && (
        <button className={styles.check} disabled={choice === null || saving} onClick={check}>
          Check answer
        </button>
      )}
      <div aria-live="polite">
        {checked && !earned && (
          <p className={styles.retry}>
            Not quite. Look back at what this source directly shows or describes, then try again.
          </p>
        )}
        {earned && (
          <div className={styles.reward}>
            <strong>✓ Hint unlocked</strong>
            <p>{quiz.explanation}</p>
            <p><strong>Your hint:</strong> {quiz.hint}</p>
            {hasNote || saved ? (
              <p>✓ Evidence note saved to your journal.</p>
            ) : onReward ? (
              <button className={styles.check} disabled={saving} onClick={saveNote}>
                {saving ? "Saving note…" : "Save evidence note"}
              </button>
            ) : (
              <p className={styles.small}>Reopen this source to find your hint again.</p>
            )}
            {failed && <p role="alert">The note could not be saved. Try the button again.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

export function SourceFootnote({ id }: { id: string }) {
  const quiz = sourceQuestions[id];
  return quiz ? (
    <footer className={styles.footnote}>
      <strong>About this source:</strong> {quiz.footnote}{" "}
      {id.startsWith("discovery-") || id === "rickshaw" || id === "street-newspaper"
        ? "Original record and credits below."
        : "Full details are in the source archive."}
    </footer>
  ) : null;
}
