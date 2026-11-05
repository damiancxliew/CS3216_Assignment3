import { describe, expect, it } from 'vitest';
import { upgradeSectionStatus, upgradeApplyHint } from '@/app/v3/teacher/[id]/upgrade-presentation';
import type { UpgradeRun } from '@/lib/v3/upgrades/types';

const run = (status: UpgradeRun['status'] = 'running'): UpgradeRun => ({
  id: 'run', adventureId: 'game', schoolId: 'school', requesterId: 'teacher',
  sourceRevision: 1, sourceSchemaVersion: '1.0.0', targetSchemaVersion: '2.1.0', proposalRevision: 1,
  status, candidate: null, findings: [], summary: { documents: 7, stages: 2, changes: [] },
  progress: { completed: 1, total: 9, label: 'Prepared 1 of 9 sections', stepId: 'evidence-preparation' },
  appliedRevision: null, error: null, instruction: '', createdAt: '',
});
describe('upgrade progress presentation', () => {
  it('distinguishes the completed, current and waiting sections after the first checkpoint', () => {
    const current = run();
    expect(upgradeSectionStatus(current, 'documents.0', true, 0)).toBe('done');
    expect(upgradeSectionStatus(current, 'documents.1', false, 1)).toBe('working');
    expect(upgradeSectionStatus(current, 'stages.0', false, 7)).toBe('waiting');
  });
  it('uses warning findings before marking an existing section complete', () => {
    const blocked = run('blocked');
    blocked.findings = [{ code: 'reading-check', path: 'documents.0.readingCheck.variants.0.support.0', message: 'Invalid support' }];
    expect(upgradeSectionStatus(blocked, 'documents.0', true, 0)).toBe('warning');
    expect(upgradeSectionStatus(blocked, 'documents.1', false, 1)).toBe('waiting');
    expect(upgradeSectionStatus(blocked, 'documents.01', true, 1)).toBe('done');
  });
  it('marks the interrupted section as failed while retaining successful sections', () => {
    expect(upgradeSectionStatus(run('failed'), 'documents.0', true, 0)).toBe('done');
    expect(upgradeSectionStatus(run('failed'), 'documents.1', false, 1)).toBe('error');
    expect(upgradeSectionStatus(run('failed'), 'stages.0', false, 7)).toBe('waiting');
  });
  it('explains why Apply is unavailable and identifies the recovery action', () => {
    const hint = (status: UpgradeRun['status']) => upgradeApplyHint({ run: run(status) });
    expect(hint('running')).toMatch(/still being prepared/);
    expect(hint('blocked')).toMatch(/Fix failed checks/);
    expect(hint('failed')).toMatch(/Retry upgrade/);
    expect(hint('stale')).toMatch(/Rebuild/);
    expect(hint('ready')).toBeNull();
    expect(upgradeApplyHint({ run: run('ready'), dirty: true })).toMatch(/Save/);
    expect(upgradeApplyHint({ run: run('ready'), loading: true })).toMatch(/Loading/);
  });
});
