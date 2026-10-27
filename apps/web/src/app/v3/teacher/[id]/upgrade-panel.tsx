"use client";
import { useEffect } from "react";
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, getUpgradePath, type AdventureSpec } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import { startUpgradeAction, getUpgradeAction, refineUpgradeAction, applyUpgradeAction, discardUpgradeAction } from "./upgrade-actions";
import { useUpgradeWorkflow, type UpgradeActions } from "./use-upgrade-workflow";
import { UpgradeReview } from "./upgrade-review";

const serverActions: UpgradeActions = { start: startUpgradeAction, get: getUpgradeAction, refine: refineUpgradeAction, apply: applyUpgradeAction, discard: discardUpgradeAction };
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
  return <section aria-label="Adventure format upgrade" className="rounded-control border border-line-strong bg-surface p-4 text-sm [overflow-wrap:anywhere]" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p>Format {version} has best-effort support. Upgrade to format {CURRENT_SCHEMA_VERSION} for current gameplay.</p>
      <button type="button" className={button.quiet} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close upgrade review' : 'Upgrade adventure'}</button>
    </div>
    {open ? <div className="mt-4 space-y-4">
      <h2 className="text-lg font-bold">Upgrade adventure</h2>
      <ul className="list-disc space-y-1 pl-5">{getUpgradePath(version).map((step) => <li key={step.id}>{step.summary}</li>)}</ul>
      <p>Review the proposal before applying it. Applying creates a new draft revision; publishing is a separate step. Published games and ongoing attempts keep their saved version.</p>
      {dirty ? <p role="status">Save your edits before preparing or applying an upgrade.</p> : null}
      {workflow.loading ? <p role="status">Loading saved upgrade progress…</p> : null}
      {workflow.message ? <p role="status">{workflow.message}</p> : null}
      {active && run ? <>
        <p role="status">{stale ? 'The draft changed. Rebuild the upgrade from the saved draft.' : `Proposal ${run.proposalRevision} · ${run.status}`}</p>
        {run.status === 'running' ? <p role="status">{run.progress.label} ({run.progress.completed} of {run.progress.total})</p> : null}
        {run.error ? <p role="alert">{run.error}</p> : null}
        {run.summary.changes.length ? <ul className="list-disc pl-5">{run.summary.changes.map((change, index) => <li key={index}>{change}</li>)}</ul> : null}
        {run.findings.length ? <section aria-label="Upgrade needs attention"><h3 className="font-bold">Needs attention before applying</h3><ul className="mt-2 list-disc space-y-1 pl-5">{run.findings.map((finding, index) => <li key={index}>{finding.message} <span className="text-muted">({finding.path})</span></li>)}</ul><p className="mt-2">Ask chat to adjust the proposal. If the source material needs editing, discard this proposal, save your changes, then prepare another upgrade.</p></section> : null}
        {!stale ? <UpgradeReview run={run} /> : null}
        {run.status !== 'running' && !stale ? <p>Use the existing chat to adjust these questions and preparation requirements while this review is open.</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button.primary} disabled={!ready || busy || dirty} onClick={() => void workflow.apply()}>{pending ? 'Working…' : 'Apply upgrade'}</button>
          {['failed', 'blocked'].includes(run.status) && !stale ? <button type="button" className={button.quiet} disabled={busy || dirty} onClick={() => void workflow.retry()}>Retry upgrade</button> : null}
          {(stale || run.status === 'stale') ? <button type="button" className={button.quiet} disabled={busy || dirty} onClick={() => void workflow.start()}>Rebuild upgrade</button> : null}
          {!stale && run.status !== 'stale' ? <button type="button" className={button.subtle} disabled={pending || workflow.loading || disabled || dirty} onClick={() => { if (window.confirm('Discard this upgrade proposal? Your saved draft will stay unchanged.')) void workflow.discard(); }}>Discard proposal</button> : null}
        </div>
      </> : <button type="button" className={button.primary} disabled={busy || dirty} onClick={() => void workflow.start()}>Prepare upgrade</button>}
    </div> : null}
  </section>;
}
