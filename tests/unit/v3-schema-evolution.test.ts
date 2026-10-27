import { describe, expect, it } from 'vitest';
import { evolutionIssues, migrationTestPaths } from '../../scripts/schema-evolution';

const state = () => ({
  current: 2,
  snapshots: { '1': '{"legacy":true}', '2': '{"current":true}' },
  emitted: { '1': '{"legacy":true}', '2': '{"current":true}' },
  steps: [{ id: 'preparation', from: 1, to: 2, tests: ['tests/api/v3-upgrades.test.ts'] }],
  declarations: [] as { baseVersion: number; targetVersion: number; kind: 'contract' | 'implementation'; reason: string; tests: string[] }[],
});
describe('persisted schema evolution gate', () => {
  it('rejects editing a released structural snapshot even when the emitted schema matches', () => {
    const base = state(), next = state();
    next.snapshots['1'] = next.emitted['1'] = '{}';
    expect(evolutionIssues(next, base, [], () => true)).toContainEqual(expect.stringContaining('Released schema 1'));
  });
  it('rejects a missing snapshot or a new schema without an upgrade test', () => {
    const next = state();
    next.emitted['2'] = '{}';
    next.steps[0]!.tests = [];
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/snapshot/);
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/migration test/);
  });
  it('requires a documented classification for semantic validation changes', () => {
    const base = state(), next = state();
    const changed = ['packages/spec-v3/src/check/core.ts'];
    expect(evolutionIssues(next, base, changed, () => true).join('\n')).toMatch(/classification/);
    next.declarations.push({ baseVersion: 2, targetVersion: 2, kind: 'implementation', reason: 'Fix reachability calculation without changing valid adventure requirements.', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(next, base, changed, () => true)).toEqual([]);
  });
  it('classifies parser and version-boundary changes as contract-sensitive', () => {
    for (const path of ['packages/spec-v3/src/index.ts', 'packages/spec-v3/src/versions.ts', 'apps/web/src/lib/v3/edit/validation.ts', 'packages/generation/src/v3/details/checks.ts'])
      expect(evolutionIssues(state(), state(), [path], () => true).join('\n')).toMatch(/classification/);
  });
  it('keeps declaration history append-only and rejects malformed classification kinds', () => {
    const base = state();
    base.declarations.push({ baseVersion: 1, targetVersion: 2, kind: 'contract', reason: 'Original upgrade', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(state(), base, [], () => true).join('\n')).toMatch(/append-only/);
    const next = state();
    next.declarations.push({ baseVersion: 2, targetVersion: 2, kind: 'invalid' as 'contract', reason: 'Bypass', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(next, state(), ['packages/spec-v3/src/check/core.ts'], () => true).join('\n')).toMatch(/kind/);
  });
  it('validates classifications without relying on a supplied comparison base', () => {
    const next = state();
    next.declarations.push({ baseVersion: 2, targetVersion: 2, kind: 'contract', reason: 'Changed requirement', tests: ['tests/unit/regression.test.ts'] });
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/increment/);
  });
  it('collects every registered migration test for execution without duplicate suites', () => {
    const next = state();
    next.steps.push({ id: 'next', from: 2, to: 3, tests: ['tests/api/v3-upgrades.test.ts', 'tests/api/next.test.ts'] });
    expect(migrationTestPaths(next)).toEqual(['tests/api/v3-upgrades.test.ts', 'tests/api/next.test.ts']);
  });
  it('requires a version increment for declared semantic contract changes', () => {
    const next = state();
    next.declarations.push({ baseVersion: 2, targetVersion: 2, kind: 'contract', reason: 'Require a new task.', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(next, state(), ['packages/spec-v3/src/check/core.ts'], () => true).join('\n')).toMatch(/increment/);
  });
  it('rejects missing paths, duplicate steps, missing test files and removed history', () => {
    const next = state();
    next.current = 3;
    next.snapshots['3' as '1'] = '{}';
    next.emitted['3' as '1'] = '{}';
    expect(evolutionIssues(next, state(), [], () => false).join('\n')).toMatch(/route|migration/);
    next.steps.push({ ...next.steps[0]! });
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/duplicate|ambiguous/i);
  });
  it('accepts a future schema with a registered chain and migration tests', () => {
    const next = state();
    next.current = 3;
    next.snapshots['3' as '1'] = next.emitted['3' as '1'] = '{}';
    next.steps.push({ id: 'next', from: 2, to: 3, tests: ['tests/api/next-migration.test.ts'] });
    expect(evolutionIssues(next, state(), [], () => true)).toEqual([]);
  });
});
