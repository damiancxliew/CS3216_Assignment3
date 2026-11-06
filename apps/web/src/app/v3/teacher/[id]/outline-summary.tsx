import type { ReactNode } from "react";
import type { SkeletonShape } from "@adventure/spec-v3";

/** The outline card, identical while reviewing it and after it is approved. */
export function OutlineSummary({ skeleton, action }: { skeleton: SkeletonShape; action?: ReactNode }) {
  return (
    <section className="creation-card rounded-surface border border-line-strong bg-surface p-5" aria-label="Adventure plan" data-review-card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold tracking-tight">{skeleton.title}</h3>
        {action}
      </div>
      <p className="text-sm leading-relaxed">{skeleton.arc}</p>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
        {skeleton.stages.map((stage) => (
          <li key={stage.id}>
            <span className="font-semibold">{stage.title}</span>
            <p className="text-muted">{stage.centralQuestion}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted">
        {skeleton.characters.length} characters · {skeleton.documents.length} documents · {skeleton.endings.length} endings
      </p>
    </section>
  );
}
