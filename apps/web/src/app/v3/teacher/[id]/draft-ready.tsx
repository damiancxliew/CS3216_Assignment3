import React, { type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Eye,
} from "lucide-react";
import type { CheckIssue } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import { ReviewIssue } from "@/components/teacher/review-issue";
import { REVIEW_PASS_LABELS } from "@/lib/v3/review-presentation";

type Warning = CheckIssue & { pass: string };

export function DraftReady({
  adventureId,
  errors,
  warnings,
  blocked,
  publishControl,
}: {
  adventureId: string;
  errors: CheckIssue[];
  warnings: Warning[];
  blocked: boolean;
  publishControl: ReactNode;
}) {
  const reviewUrl = `/v3/teacher/${adventureId}`;
  const byPass = new Map<string, Warning[]>();
  for (const warning of warnings) {
    const group = byPass.get(warning.pass) ?? [];
    group.push(warning);
    byPass.set(warning.pass, group);
  }
  return (
    <div className="space-y-6">
      <div>
        <section
          className="flex flex-col rounded-surface border border-line bg-surface p-6 shadow-[0_2px_10px_rgb(0_0_0/0.10)] sm:p-8"
          aria-labelledby="review-next"
        >
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <BookOpen aria-hidden className="size-6 text-record" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-world-wash px-3 py-1 text-xs font-bold text-world">
              <CheckCircle2 aria-hidden className="size-3.5" />
              Generation finished
            </span>
          </div>
          <h2
            id="review-next"
            className="text-2xl font-extrabold tracking-tight"
          >
            Review your adventure
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">
            Check the stages, characters and sources before sharing.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={reviewUrl} className={button.primary}>
              Review and edit <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link
              href={`/v3/teacher/${adventureId}/preview`}
              className={button.subtle}
            >
              <Eye aria-hidden className="size-4" />
              Preview as a student
            </Link>
            <div className="sm:ml-auto">{publishControl}</div>
          </div>
        </section>
      </div>
      {blocked || warnings.length ? (
        <section
          className="overflow-hidden rounded-surface border border-line bg-surface shadow-[0_2px_10px_rgb(0_0_0/0.10)]"
          aria-labelledby="attention-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sunken/40 px-6 py-4">
            <div>
              <h2 id="attention-title" className="text-lg font-extrabold">
                Needs your attention
              </h2>
              <p className="mt-1 text-sm text-muted">
                {errors.length
                  ? `${errors.length} ${errors.length === 1 ? "item" : "items"} to fix`
                  : blocked
                    ? "Items to fix"
                    : "Suggestions to review"}
                {warnings.length
                  ? ` · ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`
                  : ""}
              </p>
            </div>
            <Link href={reviewUrl} className={button.subtle}>
              Open review <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <div className="divide-y divide-line">
            {blocked && !errors.length ? (
              <p className="px-6 py-5 text-sm text-muted">
                Open review to see what needs fixing.
              </p>
            ) : null}
            {errors.length ? (
              <div className="px-6 py-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-danger">
                  <CircleAlert aria-hidden className="size-4" />
                  Needs fixing
                </h3>
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  {errors.slice(0, 5).map((error, i) => (
                    <li key={i}>
                      <ReviewIssue issue={error} />
                    </li>
                  ))}
                </ul>
                {errors.length > 5 ? (
                  <p className="mt-3 text-sm text-muted">
                    See all {errors.length} issues in the review.
                  </p>
                ) : null}
              </div>
            ) : null}
            {[...byPass].map(([pass, list]) => (
              <div key={pass} className="px-6 py-5">
                <h3 className="mb-3 text-sm font-bold">
                  {REVIEW_PASS_LABELS[pass] ?? "Other checks"}
                </h3>
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  {list.map((warning, i) => (
                    <li key={i}>
                      <ReviewIssue issue={warning} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
