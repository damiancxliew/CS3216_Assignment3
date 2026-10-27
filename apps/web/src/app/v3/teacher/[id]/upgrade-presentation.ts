import { decodeStoredSpec, type AdventureSpec } from '@adventure/spec-v3';
import type { UpgradeRun } from '@/lib/v3/upgrades/types';

export type UpgradeSectionStatus = 'done' | 'working' | 'waiting' | 'warning' | 'error';

export function upgradeSectionStatus(run: UpgradeRun, path: string, complete: boolean, taskIndex: number): UpgradeSectionStatus {
  if (run.findings.some(finding => finding.path === path || finding.path.startsWith(`${path}.`))) return 'warning';
  if (complete) return 'done';
  if (taskIndex === run.progress.completed) {
    if (run.status === 'failed') return 'error';
    if (run.status === 'running') return 'working';
  }
  return 'waiting';
}

/** Count prepared content, not attempted tasks: a failed task must not fill the bar. */
export function upgradeReviewState(run: UpgradeRun, source: AdventureSpec) {
  const decoded = decodeStoredSpec(run.candidate);
  const spec = decoded.ok ? decoded.spec : source;
  const sections = [
    ...spec.documents.map((document, index) => ({ path: `documents.${index}`, title: document.title, fingerprint: JSON.stringify(document), status: upgradeSectionStatus(run, `documents.${index}`, Boolean(document.readingCheck), index) })),
    ...spec.stages.map((stage, index) => ({ path: `stages.${index}`, title: stage.title, fingerprint: JSON.stringify(stage.preparation), status: upgradeSectionStatus(run, `stages.${index}`, Boolean(stage.preparation), spec.documents.length + index) })),
  ];
  return { spec, sections, completed: sections.filter(section => section.status === 'done').length, total: sections.length };
}
export type UpgradeReviewState = ReturnType<typeof upgradeReviewState>;

export function upgradeApplyHint({ run, dirty, loading, pending, disabled, stale }: {
  run: UpgradeRun | null; dirty?: boolean; loading?: boolean; pending?: boolean; disabled?: boolean; stale?: boolean;
}): string | null {
  if (pending) return 'An upgrade action is in progress. Please wait.';
  if (loading) return 'Loading the saved upgrade. Please wait.';
  if (dirty) return 'Save your draft edits before applying the upgrade.';
  if (stale || run?.status === 'stale') return 'The draft changed. Rebuild the upgrade first.';
  if (run?.status === 'running') return 'The upgrade is still being prepared. Apply becomes available when every section is ready.';
  if (run?.status === 'failed') return 'The upgrade stopped. Choose Retry upgrade to continue from saved progress.';
  if (run?.status === 'blocked' || run?.findings.length) return 'Some sections need changes. Choose Fix failed checks, then review the result.';
  if (disabled) return 'Finish the current edit before applying the upgrade.';
  return run?.status === 'ready' ? null : 'Prepare and review an upgrade before applying it.';
}
