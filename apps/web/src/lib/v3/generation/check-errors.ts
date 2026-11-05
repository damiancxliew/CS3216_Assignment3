import type { CheckIssue } from "@adventure/spec-v3";

export interface FinalCheckOutput {
  errors?: CheckIssue[];
  partErrors?: { part: string; issue: CheckIssue }[];
}

/** Keep part-local paths distinguishable from paths into the assembled spec. */
export function finalCheckErrors(
  check: FinalCheckOutput | null | undefined,
): CheckIssue[] {
  return [
    ...(check?.errors ?? []),
    ...(check?.partErrors ?? []).map(({ part, issue }) => ({
      ...issue,
      path: `${part}/${issue.path}`,
    })),
  ];
}
