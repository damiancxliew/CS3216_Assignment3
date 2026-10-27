"use client";
import { useEffect, useId } from "react";
import { CURRENT_SCHEMA_VERSION, compareSchemaVersions, getSchemaVersion, getUpgradePath, type AdventureSpec } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import { startUpgradeAction, getUpgradeAction, refineUpgradeAction, applyUpgradeAction, discardUpgradeAction } from "./upgrade-actions";
import { useUpgradeWorkflow, type UpgradeActions } from "./use-upgrade-workflow";
import { UpgradeReview } from "./upgrade-review";
import { useUpgradeReview } from "./use-upgrade-review";
import { upgradeApplyHint } from "./upgrade-presentation";

const serverActions: UpgradeActions = { start: startUpgradeAction, get: getUpgradeAction, refine: refineUpgradeAction, apply: applyUpgradeAction, discard: discardUpgradeAction };
const statusText = { running: 'Preparing upgrade', ready: 'Ready to review', blocked: 'Needs changes', failed: 'Could not finish', stale: 'Draft changed', applied: 'Saved', discarded: 'Discarded' };
export function UpgradePanel({ adventureId, spec, revision, dirty = false, disabled = false, onApplied, actions = serverActions, onReviewOpen, onPendingChange }: {
  adventureId: string; spec: AdventureSpec; revision: number; dirty?: boolean; disabled?: boolean;
  onApplied(spec: AdventureSpec, revision: number): void; actions?: UpgradeActions;
  onReviewOpen?(open: boolean): void;
  onPendingChange?(pending: boolean): void;
}) {
  const version = getSchemaVersion(spec);
  const workflow = useUpgradeWorkflow({ adventureId, revision, dirty, disabled, actions, onApplied, enabled: Boolean(version && compareSchemaVersions(version, CURRENT_SCHEMA_VERSION) < 0) });
  useEffect(() => onReviewOpen?.(workflow.open), [workflow.open, onReviewOpen]);
  useEffect(() => {
    onPendingChange?.(workflow.pending);
    return () => onPendingChange?.(false);
  }, [workflow.pending, onPendingChange]);
  const { review, reviewed, markReviewed, latestPath } = useUpgradeReview(workflow.run, spec);
  const applyHintId = useId();
  if (!version || version === CURRENT_SCHEMA_VERSION) return null;
  const { run, open, setOpen, busy, pending, stale } = workflow;
  const active = Boolean(run && !['discarded', 'applied'].includes(run.status));
  const ready = run?.status === 'ready' && !stale && run.findings.length === 0;
  const remainingReviews = review ? review.total - reviewed.size : 0;
  const applyHint = upgradeApplyHint({ run, dirty, loading: workflow.loading, pending, disabled, stale })
    ?? (remainingReviews > 0 ? `Mark all sections as Reviewed before applying (${remainingReviews} left).` : null);
  const changes = run?.summary.changes.length ? run.summary.changes : getUpgradePath(version).map(step => step.summary);
  const location = (path: string) => {
    const [kind, index] = path.split('.');
    return kind === 'documents' ? spec.documents[Number(index)]?.title : kind === 'stages' ? spec.stages[Number(index)]?.title : undefined;
  };
  const findings = [...new Map((run?.findings ?? []).map(finding => {
    const title = location(finding.path);
    const message = [...new Set(finding.message.split(/(?<=\.)\s+/))].join(' ');
    return [`${title ?? finding.path}:${message}`, { ...finding, message, title }];
  })).values()];
  return <section aria-label="Adventure format upgrade" className="rounded-control border border-line-strong bg-surface p-4 text-sm [overflow-wrap:anywhere]" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p>Format {version}. Older formats have limited support.</p>
      <button type="button" className={button.quiet} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close review' : 'Upgrade adventure'}</button>
    </div>
    {open ? <div className="mt-4 space-y-4">
      <h2 className="text-lg font-bold">Upgrade to format {CURRENT_SCHEMA_VERSION}</h2>
      <ul className="list-disc space-y-1 pl-5">{changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
      <p>Apply saves a new draft. Publish separately; published games and attempts keep their version.</p>
      {dirty ? <p role="status">Save your edits first.</p> : null}
      {workflow.loading ? <p role="status">Loading upgrade…</p> : null}
      {workflow.message ? <p role="status">{workflow.message}</p> : null}
      {active && run ? <>
        <div className="space-y-2" aria-label="Upgrade progress">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p role="status">{stale ? 'Draft changed. Rebuild the proposal.' : statusText[run.status]}</p>
            {review ? <p className="text-xs text-muted">{review.completed} of {review.total} sections ready · {reviewed.size} reviewed</p> : null}
          </div>
          {review ? <div role="progressbar" aria-label="Upgrade preparation" aria-valuemin={0} aria-valuemax={review.total} aria-valuenow={review.completed} aria-valuetext={`${review.completed} of ${review.total} sections ready`} className="h-3 overflow-hidden rounded-full border border-line-strong bg-sunken">
            <div className={`h-full transition-[width] duration-300 motion-reduce:transition-none ${run.status === 'failed' ? 'bg-danger' : 'bg-world'}`} style={{ width: `${review.total ? review.completed / review.total * 100 : 0}%` }} />
          </div> : null}
        </div>
        {run.error ? <p role="alert">{run.error}</p> : null}
        {findings.length ? <section aria-label="Upgrade needs attention" className="rounded-control border border-line-strong p-3">
          <h3 className="font-bold">Some checks need fixing</h3>
          <p className="mt-1">The upgrade hasn’t been applied. Fix failed checks to try again; completed checks are kept.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{findings.map((finding, index) => <li key={index}>{finding.title ? `${finding.title}: ` : ''}{finding.message}</li>)}</ul>
          {run.status === 'blocked' && !stale ? <button type="button" className={`${button.primary} mt-3`} disabled={busy || dirty} onClick={() => void workflow.retry()}>Fix failed checks</button> : null}
          <p className="mt-2">For specific changes, use chat below. If the source itself needs editing, discard this proposal, edit and save the draft, then prepare a new upgrade.</p>
        </section> : null}
        {!stale && review ? <UpgradeReview latestPath={latestPath} review={review} reviewed={reviewed} onReviewed={markReviewed} /> : null}
        {run.status !== 'running' && !stale && !run.findings.length ? <p>Ask chat to revise questions or requirements.</p> : null}
        <div className="flex flex-wrap gap-2">
          <span className="group/apply relative inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-record" tabIndex={applyHint ? 0 : undefined} role={applyHint ? 'group' : undefined} aria-label={applyHint ? 'Apply upgrade unavailable' : undefined} aria-describedby={applyHint ? applyHintId : undefined}>
            <button type="button" className={`${button.primary} disabled:pointer-events-none`} disabled={!ready || busy || dirty || remainingReviews > 0} aria-describedby={applyHint ? applyHintId : undefined} onClick={() => void workflow.apply()}>{pending ? 'Working…' : 'Apply upgrade'}</button>
            {applyHint ? <span id={applyHintId} role="tooltip" className="pointer-events-none invisible absolute bottom-full left-0 z-50 mb-2 w-64 max-w-[calc(100vw-3rem)] rounded-control border border-ink bg-ink px-3 py-2 text-xs text-paper shadow-md group-hover/apply:visible group-focus-within/apply:visible">{applyHint}</span> : null}
          </span>
          {run.status === 'failed' && !stale ? <button type="button" className={button.quiet} disabled={busy || dirty} onClick={() => void workflow.retry()}>Retry upgrade</button> : null}
          {(stale || run.status === 'stale') ? <button type="button" className={button.quiet} disabled={busy || dirty} onClick={() => void workflow.start()}>Rebuild upgrade</button> : null}
          {!stale && run.status !== 'stale' ? <button type="button" className={button.subtle} disabled={pending || workflow.loading || disabled || dirty} onClick={() => { if (window.confirm('Discard this proposal? Your draft will stay as it is.')) void workflow.discard(); }}>Discard proposal</button> : null}
        </div>
      </> : <button type="button" className={button.primary} disabled={busy || dirty} onClick={() => void workflow.start()}>Prepare upgrade</button>}
    </div> : null}
  </section>;
}
