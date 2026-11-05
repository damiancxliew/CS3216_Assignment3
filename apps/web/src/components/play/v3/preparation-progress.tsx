import { Check } from "lucide-react";
import styles from "./preparation-progress.module.css";

/** Uses the engine's required preparation, rather than counting optional discoveries. */
export function PreparationProgress({ label, completed, required }: { label: string; completed: number; required: number }) {
  const total = Math.max(1, required);
  const value = required === 0 ? total : Math.max(0, Math.min(completed, required));
  const complete = value === total;
  return <span className={styles.progress}>
    <span className={styles.label}>
      <span>{label}: {Math.min(completed, required)} of {required}</span>
      {complete ? <Check size={14} aria-label="Complete" /> : null}
    </span>
    <span className={styles.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-valuetext={required ? `${Math.min(completed, required)} of ${required} complete` : "No tasks required"}>
      <span className={styles.fill} style={{ width: `${value / total * 100}%` }} />
    </span>
  </span>;
}
