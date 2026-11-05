import React from "react";
import type { CheckIssue } from "@adventure/spec-v3";
import { reviewIssueMessage } from "@/lib/v3/review-presentation";

export function ReviewIssue({
  issue,
  onSelect,
  location,
  expanded = false,
}: {
  issue: CheckIssue;
  onSelect?: () => void;
  location?: string;
  expanded?: boolean;
}) {
  const message = reviewIssueMessage(issue);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {onSelect ? (
          <button
            type="button"
            className="text-left underline"
            onClick={onSelect}
          >
            {message}
          </button>
        ) : (
          <p>{message}</p>
        )}
        {location ? (
          <span className="text-xs text-muted">{location}</span>
        ) : null}
      </div>
      <details open={expanded || undefined} className="text-xs text-muted">
        <summary className="w-fit cursor-pointer">Details</summary>
        <div className="mt-2 space-y-1 break-words rounded-lg bg-sunken p-3 [overflow-wrap:anywhere]">
          {message !== issue.message ? <p>{issue.message}</p> : null}
          <p>
            Reference: <code>{issue.code}</code>
          </p>
          {issue.path ? (
            <p>
              Location: <code>{issue.path}</code>
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
