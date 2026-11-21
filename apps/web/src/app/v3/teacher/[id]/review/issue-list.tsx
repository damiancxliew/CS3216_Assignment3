import type { CheckIssue } from "@adventure/spec-v3";
import { reviewIssueMessage } from "@/lib/v3/review-presentation";

/**
 * The one presentation for blocking issues at every review stage: teacher
 * wording (never raw paths), and optional jump-to-card links.
 */
export function IssueList({
  issues,
  warnings = [],
  onSelect,
  message = reviewIssueMessage,
}: {
  issues: CheckIssue[];
  warnings?: CheckIssue[];
  onSelect?: (issue: CheckIssue) => void;
  message?: (issue: CheckIssue) => string;
}) {
  if (!issues.length && !warnings.length) return null;
  const item = (issue: CheckIssue, blocking: boolean, index: number) => (
    <li key={`${blocking ? "e" : "w"}${index}`} className={blocking ? undefined : "text-muted"}>
      {onSelect ? (
        <button type="button" onClick={() => onSelect(issue)} className="text-left underline decoration-dotted underline-offset-2">
          {message(issue)}
        </button>
      ) : message(issue)}
    </li>
  );
  return (
    <section className="rounded-surface border border-signal/40 bg-surface p-4" aria-label="Issues to resolve">
      {issues.length ? (
        <p role="alert" className="mb-2 text-sm font-semibold">
          {issues.length === 1 ? "One issue needs" : `${issues.length} issues need`} attention before you can continue.
        </p>
      ) : null}
      <ul className="list-disc space-y-2 pl-4 text-sm">
        {issues.map((issue, index) => item(issue, true, index))}
        {warnings.map((issue, index) => item(issue, false, index))}
      </ul>
    </section>
  );
}
