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
  const issues = localEditIssues(draft).filter((issue) => !existing.has(key(issue)));
  const before = validateSpec(base), after = validateSpec(draft);
  if (before.ok && after.ok) after.spec.documents.forEach((doc, i) => {
    const old = before.spec.documents.find((item) => item.id === doc.id);
    if (old?.readingCheck && old.body !== doc.body && JSON.stringify(old.readingCheck) === JSON.stringify(doc.readingCheck))
      issues.push({ code: "reading-check", path: `documents.${i}.readingCheck`, message: "The document changed. Review the reading questions and update their supporting passages before saving." });
  });
  return issues;
}
