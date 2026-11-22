import { BookOpen, Check, Pencil, Route, ShieldCheck, Timer, TimerOff } from "lucide-react";
import { sourcePolicyLabel, timerLabel, type BriefStateV3 } from "@/lib/v3/brief/schema";
import { SourceMaterial } from "./brief-sources";
import styles from "./creation-workspace.module.css";

const modeDescriptions = {
  standard: "Review the outline before scenes are written.",
  quick: "Review the complete adventure at the end.",
  guided: "Review each part as it is created.",
};
const readingLevels = { sec: "Secondary", jc: "Junior college" } as const;
const modeName = (mode: keyof typeof modeDescriptions) => `${mode[0].toUpperCase()}${mode.slice(1)} mode`;

export function BriefOverview({ brief, disabled, onChange, onFiles, onRemove, removing, removeError }: {
  brief: BriefStateV3;
  disabled: boolean;
  onChange(slot: string): void;
  onFiles?: (files: File[]) => void;
  onRemove?: (sourceId: string) => void;
  removing?: string | null;
  removeError?: string | null;
}) {
  const { draft } = brief;
  const Clock = draft.timerMinutes === null ? TimerOff : Timer;
  const edit = (slot: string, label: string) => (
    <button type="button" className={styles.iconButton} aria-label={`Change ${label}`} title={`Change ${label}`} disabled={disabled} onClick={() => onChange(slot)}>
      <Pencil size={16} aria-hidden />
    </button>
  );
  return <>
    <div className={styles.step} data-brief-step="sources">
      <p className={styles.stepDivider}><span>01 · Sources</span></p>
      <SourceMaterial adventureId={brief.adventureId} sources={brief.sources} onFiles={onFiles} onRemove={onRemove} removing={removing} removeError={removeError} uploadDisabled={disabled} />
    </div>
    {draft.episode !== undefined || draft.focus !== undefined ? (
      <div className={styles.step} data-brief-step="story">
        <p className={styles.stepDivider}><span>Story brief</span></p>
        <section className={styles.card} aria-labelledby="story-brief-heading">
          <div className={styles.cardHead}>
            <h2 className={styles.tag} id="story-brief-heading"><Route size={14} aria-hidden />The adventure</h2>
            {draft.episode !== undefined ? edit("episode", "episode") : null}
          </div>
          {draft.episode ? <p className={styles.storyTitle}>{draft.episode}</p> : null}
          {draft.focus !== undefined ? <dl>
            <div className="flex items-center justify-between gap-2">
              <dt className={styles.label}>Learning focus</dt>
              {edit("focus", "learning focus")}
            </div>
            <dd className={styles.value}>{draft.focus || "No additional guidance"}</dd>
          </dl> : null}
        </section>
      </div>
    ) : null}
    {draft.timerMinutes !== undefined || draft.readingLevel !== undefined ? (
      <div className={styles.step} data-brief-step="class">
        <p className={styles.stepDivider}><span>Your class</span></p>
        <section className={styles.card} aria-labelledby="class-settings-heading">
          <div className={styles.cardHead}><h2 className={styles.tag} id="class-settings-heading"><BookOpen size={14} aria-hidden />Your class</h2></div>
          <dl className={styles.classGrid}>
            <div className={styles.classTile}>
              <div className="flex items-center justify-between gap-2">
                <dt className={styles.label}>Adventure timer</dt>
                {draft.timerMinutes !== undefined ? edit("timer", "timer") : null}
              </div>
              <dd className={styles.classValue}><Clock size={22} aria-hidden />{draft.timerMinutes === undefined ? "Not set" : timerLabel(draft.timerMinutes)}</dd>
            </div>
            <div className={styles.classTile}>
              <div className="flex items-center justify-between gap-2">
                <dt className={styles.label}>Reading level</dt>
                {draft.readingLevel !== undefined ? edit("readingLevel", "reading level") : null}
              </div>
              <dd className={styles.classValue}><BookOpen size={22} aria-hidden />{draft.readingLevel ? readingLevels[draft.readingLevel] : "Not set"}</dd>
            </div>
          </dl>
        </section>
      </div>
    ) : null}
    {draft.mode !== undefined || draft.sourcePolicy !== undefined ? (
      <div className={styles.step} data-brief-step="review">
        <p className={styles.stepDivider}><span>Review & research</span></p>
        <section className={styles.card} aria-labelledby="review-settings-heading">
          <div className={styles.cardHead}><h2 className={styles.tag} id="review-settings-heading"><Check size={14} aria-hidden />Before you create</h2></div>
          <dl className={styles.reviewGrid}>
            {draft.mode ? <div>
              <div className="flex items-center justify-between gap-2"><dt className={styles.label}>Review checkpoints</dt>{edit("mode", "review mode")}</div>
              <dd className={styles.badge}><Route size={14} aria-hidden />{modeName(draft.mode)}</dd>
            </div> : null}
            <div>
              <div className="flex items-center justify-between gap-2"><dt className={styles.label}>Outside sources</dt>{edit("allowlist", "outside sources")}</div>
              <dd className={`${styles.badge} ${draft.sourcePolicy?.allowAny ? "" : styles.trusted}`}><ShieldCheck size={14} aria-hidden />{draft.sourcePolicy === null ? "Choose in the conversation" : sourcePolicyLabel(draft.sourcePolicy)}</dd>
            </div>
          </dl>
          {draft.mode ? <p className={styles.note}>{modeDescriptions[draft.mode]}</p> : null}
        </section>
      </div>
    ) : null}
  </>;
}

/** After Create: the brief stays visible, read-only and collapsed, above the generated steps. */
export function BriefSummary({ brief }: { brief: BriefStateV3 }) {
  const { draft } = brief;
  const rows: [string, string][] = [
    ["Learning focus", draft.focus || "No additional guidance"],
    ["Reading level", draft.readingLevel ? readingLevels[draft.readingLevel] : "Not set"],
    ["Adventure timer", draft.timerMinutes === undefined ? "Not set" : timerLabel(draft.timerMinutes)],
    ["Review checkpoints", draft.mode ? `${modeName(draft.mode)}. ${modeDescriptions[draft.mode]}` : "Not set"],
    ["Outside sources", sourcePolicyLabel(draft.sourcePolicy ?? undefined)],
  ];
  return (
    <div className={styles.step} data-brief-step="summary">
      <p className={styles.stepDivider}><span>Your brief</span></p>
      <details className={styles.card}>
        <summary className="cursor-pointer text-sm font-bold">{draft.episode ?? "The adventure"}</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className={styles.label}>{label}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
