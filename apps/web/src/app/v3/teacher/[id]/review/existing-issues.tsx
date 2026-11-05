import type { CheckIssue } from "@adventure/spec-v3";
import { reviewIssueMessage } from "@/lib/v3/review-presentation";

export function ExistingIssues({ issues }: { issues: CheckIssue[] }) {
  if (!issues.length) return null;
  return (
    <details className="rounded-surface border border-line p-4">
      <summary className="cursor-pointer font-bold">
        Existing generation issues ({issues.length})
      </summary>
      <p className="my-2 text-sm">
        These were already in the generated draft. You can keep editing; only
        new errors will stop you from saving or continuing.
      </p>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        {issues.map((issue, index) => (
          <li key={index}>{reviewIssueMessage(issue)}</li>
        ))}
      </ul>
    </details>
  );
}
