/** Display labels for the generation passes, in pipeline order. */
export const PASS_ORDER = ["sources", "skeleton", "details", "endings", "reveal", "check", "save"] as const;
export type PassName = (typeof PASS_ORDER)[number];

export const PASS_LABELS: Record<PassName, string> = {
  sources: "Sources",
  skeleton: "Skeleton",
  details: "Stage details and personas",
  endings: "Endings",
  reveal: "Reveal",
  check: "Checks",
  save: "Saving",
};

export type StepDisplayStatus = "waiting" | "running" | "done" | "failed";

/** Maps a job_step row status (or a step not enqueued yet) to what the progress list shows. */
export function stepDisplayStatus(status: string | undefined): StepDisplayStatus {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
    default:
      return "waiting";
  }
}

/** /teacher list badges for a v3 adventure row. */
export const V3_STATUS_LABELS: Record<string, string> = {
  briefing: "Setting up",
  generating: "Generating",
  needs_review: "Skeleton to check",
  draft: "Ready",
  failed: "Failed",
  published: "Published",
};
