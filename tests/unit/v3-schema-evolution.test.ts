import { describe, expect, it } from 'vitest';
import { evolutionIssues, migrationTestPaths, type EvolutionState } from '../../scripts/schema-evolution';

const state = (): EvolutionState => ({
  current: '2.0.0',
  snapshots: { '1.0.0': '{"legacy":true}', '2.0.0': '{"current":true}' },
  emitted: { '1.0.0': '{"legacy":true}', '2.0.0': '{"current":true}' },
  steps: [{ id: 'preparation', from: '1.0.0', to: '2.0.0', tests: ['tests/api/v3-upgrades.test.ts'] }],
  declarations: [] as { baseVersion: string; targetVersion: string; kind: 'contract' | 'implementation'; reason: string; tests: string[] }[],
});
describe('persisted schema evolution gate', () => {
  it('rejects editing a released structural snapshot even when the emitted schema matches', () => {
    const base = state(), next = state();
    next.snapshots['1.0.0'] = next.emitted['1.0.0'] = '{}';
    expect(evolutionIssues(next, base, [], () => true)).toContainEqual(expect.stringContaining('Released schema 1.0.0'));
  });
  it('rejects a missing snapshot or a new schema without an upgrade test', () => {
    const next = state();
    next.emitted['2.0.0'] = '{}';
    next.steps[0]!.tests = [];
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/snapshot/);
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/migration test/);
  });
  it('requires a documented classification for semantic validation changes', () => {
    const base = state(), next = state();
    const changed = ['packages/spec-v3/src/check/core.ts'];
    expect(evolutionIssues(next, base, changed, () => true).join('\n')).toMatch(/classification/);
    next.declarations.push({ baseVersion: '2.0.0', targetVersion: '2.0.0', kind: 'implementation', reason: 'Fix reachability calculation without changing valid adventure requirements.', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(next, base, changed, () => true)).toEqual([]);
  });
  it('classifies parser and version-boundary changes as contract-sensitive', () => {
    for (const path of ['packages/spec-v3/src/index.ts', 'packages/spec-v3/src/versions.ts', 'apps/web/src/lib/v3/edit/validation.ts', 'packages/generation/src/v3/details/checks.ts'])
      expect(evolutionIssues(state(), state(), [path], () => true).join('\n')).toMatch(/classification/);
  });
  it('keeps declaration history append-only and rejects malformed classification kinds', () => {
    const base = state();
    base.declarations.push({ baseVersion: '1.0.0', targetVersion: '2.0.0', kind: 'contract', reason: 'Original upgrade', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(state(), base, [], () => true).join('\n')).toMatch(/append-only/);
    const next = state();
    next.declarations.push({ baseVersion: '2.0.0', targetVersion: '2.0.0', kind: 'invalid' as 'contract', reason: 'Bypass', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(next, state(), ['packages/spec-v3/src/check/core.ts'], () => true).join('\n')).toMatch(/kind/);
  });
  it('validates classifications without relying on a supplied comparison base', () => {
    const next = state();
    next.declarations.push({ baseVersion: '2.0.0', targetVersion: '2.0.0', kind: 'contract', reason: 'Changed requirement', tests: ['tests/unit/regression.test.ts'] });
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/increment/);
  });
  it('collects every registered migration test for execution without duplicate suites', () => {
    const next = state();
    next.steps.push({ id: 'next', from: '2.0.0', to: '2.1.0', tests: ['tests/api/v3-upgrades.test.ts', 'tests/api/next.test.ts'] });
    expect(migrationTestPaths(next)).toEqual(['tests/api/v3-upgrades.test.ts', 'tests/api/next.test.ts']);
  });
  it('requires a version increment for declared semantic contract changes', () => {
    const next = state();
    next.declarations.push({ baseVersion: '2.0.0', targetVersion: '2.0.0', kind: 'contract', reason: 'Require a new task.', tests: ['tests/api/v3-upgrades.test.ts'] });
    expect(evolutionIssues(next, state(), ['packages/spec-v3/src/check/core.ts'], () => true).join('\n')).toMatch(/increment/);
  });
  it('rejects missing paths, duplicate steps, missing test files and removed history', () => {
    const next = state();
    next.current = '2.1.0';
    next.snapshots['2.1.0'] = '{}';
    next.emitted['2.1.0'] = '{}';
    expect(evolutionIssues(next, state(), [], () => false).join('\n')).toMatch(/route|migration/);
    next.steps.push({ ...next.steps[0]! });
    expect(evolutionIssues(next, undefined, [], () => true).join('\n')).toMatch(/duplicate|ambiguous/i);
  });
  it('rejects removing an old snapshot and all its routes even when current stays unchanged', () => {
    const base = state(), next = state();
    delete next.snapshots['1.0.0'];
    delete next.emitted['1.0.0'];
    next.steps = [];
    expect(evolutionIssues(next, base, [], () => true).join('\n')).toMatch(/Released schema 1.0.0.*immutable/);
  });
  it('compares minor and patch versions numerically rather than lexically', () => {
    const base = state(), next = state();
    base.current = '2.9.0';
    base.snapshots['2.9.0'] = base.emitted['2.9.0'] = '{}';
    base.steps.push({ id: 'minor-nine', from: '2.0.0', to: '2.9.0', tests: ['tests/api/next.test.ts'] });
    next.current = '2.10.0';
    next.snapshots['2.9.0'] = next.emitted['2.9.0'] = '{}';
    next.snapshots['2.10.0'] = next.emitted['2.10.0'] = '{}';
    next.steps = [...base.steps, { id: 'minor-ten', from: '2.9.0', to: '2.10.0', tests: ['tests/api/next.test.ts'] }];
    expect(evolutionIssues(next, base, [], () => true)).toEqual([]);
    expect(evolutionIssues(base, next, [], () => true).join('\n')).toMatch(/cannot decrease/);
  });
  it('accepts a future schema with a registered chain and migration tests', () => {
    const next = state();
    next.current = '2.1.0';
    next.snapshots['2.1.0'] = next.emitted['2.1.0'] = '{}';
    next.steps.push({ id: 'next', from: '2.0.0', to: '2.1.0', tests: ['tests/api/next-migration.test.ts'] });
    expect(evolutionIssues(next, state(), [], () => true)).toEqual([]);
  });
});
