import {
  checkSpec,
  editableIssues,
  validateSpec,
  type CheckIssue,
} from "@adventure/spec-v3";

/** Immediate checks only. Save also verifies captured sources and quotations. */
export function localEditIssues(raw: unknown): CheckIssue[] {
  const parsed = validateSpec(raw);
  if (!parsed.ok)
    return parsed.issues.map((issue) => ({ ...issue, code: "schema" }));
  return [
    ...checkSpec(parsed.spec).errors,
    ...(!parsed.spec.authoring ? editableIssues(parsed.spec) : []),
  ];
}
export function newLocalErrors(base: unknown, draft: unknown): CheckIssue[] {
  const key = (issue: CheckIssue) =>
    `${issue.code}|${issue.path}|${issue.message}`;
  const existing = new Set(localEditIssues(base).map(key));
  return localEditIssues(draft).filter((issue) => !existing.has(key(issue)));
}
