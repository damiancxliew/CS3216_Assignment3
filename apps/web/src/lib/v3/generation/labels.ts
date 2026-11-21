/** The generation passes, in pipeline order. */
export const PASS_ORDER = ["sources", "skeleton", "details", "endings", "reveal", "check", "save"] as const;
export type PassName = (typeof PASS_ORDER)[number];

/** /teacher list badges for a v3 adventure row. */
export const V3_STATUS_LABELS: Record<string, string> = {
  briefing: "Setting up",
  generating: "Generating",
  needs_review: "Ready to review",
  draft: "Ready",
  failed: "Stopped",
  published: "Published",
};
