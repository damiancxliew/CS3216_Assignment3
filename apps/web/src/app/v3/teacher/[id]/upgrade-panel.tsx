"use client";
import { useEffect } from "react";
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, getUpgradePath, type AdventureSpec } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import { startUpgradeAction, getUpgradeAction, refineUpgradeAction, applyUpgradeAction, discardUpgradeAction } from "./upgrade-actions";
import { useUpgradeWorkflow, type UpgradeActions } from "./use-upgrade-workflow";
import { UpgradeReview } from "./upgrade-review";

const serverActions: UpgradeActions = { start: startUpgradeAction, get: getUpgradeAction, refine: refineUpgradeAction, apply: applyUpgradeAction, discard: discardUpgradeAction };
const statusText = { running: 'Preparing upgrade', ready: 'Ready to review', blocked: 'Needs changes', failed: 'Could not finish', stale: 'Draft changed', applied: 'Saved', discarded: 'Discarded' };
export function UpgradePanel({ adventureId, spec, revision, dirty = false, disabled = false, onApplied, actions = serverActions, onReviewOpen, onPendingChange }: {
  adventureId: string; spec: AdventureSpec; revision: number; dirty?: boolean; disabled?: boolean;
  onApplied(spec: AdventureSpec, revision: number): void; actions?: UpgradeActions;
  onReviewOpen?(open: boolean): void;
  onPendingChange?(pending: boolean): void;
}) {
  const version = getSchemaVersion(spec);
  const workflow = useUpgradeWorkflow({ adventureId, revision, dirty, disabled, actions, onApplied, enabled: Boolean(version && version < CURRENT_SCHEMA_VERSION) });
  useEffect(() => onReviewOpen?.(workflow.open), [workflow.open, onReviewOpen]);
  useEffect(() => {
    onPendingChange?.(workflow.pending);
    return () => onPendingChange?.(false);
  }, [workflow.pending, onPendingChange]);
  if (!version || version === CURRENT_SCHEMA_VERSION) return null;
  const { run, open, setOpen, busy, pending, stale } = workflow;
  const active = Boolean(run && !['discarded', 'applied'].includes(run.status));
  const ready = run?.status === 'ready' && !stale && run.findings.length === 0;
  const changes = run?.summary.changes.length ? run.summary.changes : getUpgradePath(version).map(step => step.summary);
  const location = (path: string) => {
    const [kind, index] = path.split('.');
    return kind === 'documents' ? spec.documents[Number(index)]?.title : kind === 'stages' ? spec.stages[Number(index)]?.title : undefined;
  };
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
        <p role="status">{stale ? 'Draft changed. Rebuild the proposal.' : statusText[run.status]}{run.status === 'running' ? ` (${run.progress.completed}/${run.progress.total})` : ''}</p>
        {run.error ? <p role="alert">{run.error}</p> : null}
        {run.findings.length ? <section aria-label="Upgrade needs attention"><h3 className="font-bold">Fix before applying</h3><ul className="mt-2 list-disc space-y-1 pl-5">{run.findings.map((finding, index) => <li key={index}>{location(finding.path) ? `${location(finding.path)}: ` : ''}{finding.message}</li>)}</ul><p className="mt-2">Ask chat to revise this proposal. For source changes, discard it, save your edits, then rebuild.</p></section> : null}
        {!stale ? <UpgradeReview run={run} /> : null}
        {run.status !== 'running' && !stale && !run.findings.length ? <p>Ask chat to revise questions or requirements.</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button.primary} disabled={!ready || busy || dirty} onClick={() => void workflow.apply()}>{pending ? 'Working…' : 'Apply upgrade'}</button>
          {['failed', 'blocked'].includes(run.status) && !stale ? <button type="button" className={button.quiet} disabled={busy || dirty} onClick={() => void workflow.retry()}>Retry upgrade</button> : null}
          {(stale || run.status === 'stale') ? <button type="button" className={button.quiet} disabled={busy || dirty} onClick={() => void workflow.start()}>Rebuild upgrade</button> : null}
          {!stale && run.status !== 'stale' ? <button type="button" className={button.subtle} disabled={pending || workflow.loading || disabled || dirty} onClick={() => { if (window.confirm('Discard this proposal? Your draft will stay as it is.')) void workflow.discard(); }}>Discard proposal</button> : null}
        </div>
      </> : <button type="button" className={button.primary} disabled={busy || dirty} onClick={() => void workflow.start()}>Prepare upgrade</button>}
    </div> : null}
  </section>;
}
