import type { ReactNode } from "react";
import type { GuidedPass } from "@/lib/v3/generation/service";
import styles from "./creation-workspace.module.css";

/** Every pass the teacher can see, plus the final checks after the reveal. */
export type SectionKey = GuidedPass | "finish";

/** The single source of stage names: dividers, the content header and history all use it. */
export const generationSections: Record<SectionKey, { number: string; title: string }> = {
  sources: { number: "01", title: "Sources" },
  skeleton: { number: "02", title: "Story outline" },
  details: { number: "03", title: "Stages, characters and documents" },
  endings: { number: "04", title: "Decisions and endings" },
  reveal: { number: "05", title: "Reveal and questions" },
  finish: { number: "06", title: "Checks and saving" },
};

/**
 * `current` marks the step the teacher should look at now; the workspace
 * scrolls its top into view whenever it changes or finishes generating.
 */
export function GenerationSection({ pass, current = false, pending = false, children }: {
  pass: SectionKey;
  current?: boolean;
  /** Still being written (a placeholder). */
  pending?: boolean;
  children: ReactNode;
}) {
  const { number, title } = generationSections[pass];
  return <section
    className={styles.step}
    data-generation-section={pass}
    data-generation-current={current ? (pending ? "pending" : "ready") : undefined}
    aria-label={`${number} · ${title}`}
  >
    <h2 className={styles.stepDivider}><span>{number} · {title}</span></h2>
    {children}
  </section>;
}
