import { compareSchemaVersions } from '../packages/spec-v3/src/index';

export type EvolutionDeclaration = {
  baseVersion: string;
  targetVersion: string;
  kind: 'contract' | 'implementation';
  reason: string;
  tests: string[];
};
export type EvolutionState = {
  current: string;
  snapshots: Record<string, string>;
  emitted: Record<string, string>;
  steps: { id: string; from: string; to: string; tests: string[] }[];
  declarations: EvolutionDeclaration[];
};

/** Normalize only the released integer aliases when reading pre-SemVer CI history. */
export function evolutionVersion(value: unknown): string {
  if (value === 1) return '1.0.0';
  if (value === 2) return '2.0.0';
  if (typeof value !== 'string') throw Error('A schema version must be a stable SemVer identifier.');
  compareSchemaVersions(value, value);
  return value;
}
const validVersion = (value: string) => { try { evolutionVersion(value); return true; } catch { return false; } };

/** Pure checks, shared by CI and negative regression tests. */
export function evolutionIssues(next: EvolutionState, base: EvolutionState | undefined, changed: string[], exists: (path: string) => boolean): string[] {
  const errors: string[] = [];
  if (!validVersion(next.current)) return ['The current schema version must be a stable SemVer identifier.'];
  const versions = new Set([next.current, ...Object.keys(next.snapshots), ...Object.keys(next.emitted), ...Object.keys(base?.snapshots ?? {})]);
  if ([...versions].some(version => !validVersion(version))) return ['Schema snapshot keys must use stable SemVer identifiers.'];
  for (const version of versions) {
    if (!next.snapshots[version] || next.snapshots[version] !== next.emitted[version]) errors.push(`Schema ${version} does not match its checked-in snapshot.`);
    if (base?.snapshots[version] && base.snapshots[version] !== next.snapshots[version]) errors.push(`Released schema ${version} is immutable. Add a new version and upgrade path.`);
    if (compareSchemaVersions(version, next.current) > 0) errors.push(`Schema ${version} is newer than the current schema.`);
    let at = version;
    while (compareSchemaVersions(at, next.current) < 0) {
      const outgoing = next.steps.filter(step => step.from === at);
      const step = outgoing[0];
      if (outgoing.length !== 1 || !step || !validVersion(step.to) || compareSchemaVersions(step.to, at) <= 0 || compareSchemaVersions(step.to, next.current) > 0) {
        errors.push(`Schema ${version} has a missing or ambiguous migration route to ${next.current}.`);
        break;
      }
      at = step.to;
    }
  }
  const ids = new Set<string>();
  for (const step of next.steps) {
    if (ids.has(step.id)) errors.push(`Duplicate migration ${step.id}.`);
    ids.add(step.id);
    if (!validVersion(step.from) || !validVersion(step.to) || compareSchemaVersions(step.to, step.from) <= 0 || compareSchemaVersions(step.to, next.current) > 0 || !next.snapshots[step.from] || !next.snapshots[step.to]) errors.push(`Invalid migration ${step.id}.`);
    if (!step.tests.length || step.tests.some(test => !test.endsWith('.test.ts') || !exists(test))) errors.push(`Migration ${step.id} needs an existing migration test.`);
  }
  if (base) {
    if (compareSchemaVersions(next.current, base.current) < 0) errors.push('The current schema version cannot decrease.');
    for (const step of base.steps) if (!next.steps.some(item => item.id === step.id && item.from === step.from && item.to === step.to)) errors.push(`Released migration ${step.id} cannot be removed.`);
    if (base.declarations.some((item, i) => JSON.stringify(item) !== JSON.stringify(next.declarations[i]))) errors.push('Contract-change declarations are append-only history.');
    const validationChanged = changed.some(path =>
      /^packages\/spec-v3\/src\/(check\/|reading-support\.ts|preparation\.ts|index\.ts|versions\.ts)/.test(path)
      || path === 'apps/web/src/lib/v3/edit/validation.ts'
      || path === 'packages/generation/src/v3/details/checks.ts');
    const additions = next.declarations.filter(item => !base.declarations.some(old => JSON.stringify(old) === JSON.stringify(item)));
    const declaration = additions.find(item => item.baseVersion === base.current && item.targetVersion === next.current);
    if (validationChanged && !declaration) errors.push('Semantic validation changes require a new contract-change classification with regression tests.');
  }
  for (const item of next.declarations) {
    if (!['contract', 'implementation'].includes(item.kind)) errors.push('Each classification kind must be contract or implementation.');
    const valid = validVersion(item.baseVersion) && validVersion(item.targetVersion);
    if (!valid || compareSchemaVersions(item.targetVersion, item.baseVersion) < 0 || compareSchemaVersions(item.targetVersion, next.current) > 0) errors.push('Each classification must name valid source and target schema versions.');
    if (!item.reason.trim() || !item.tests.length || item.tests.some(test => !test.endsWith('.test.ts') || !exists(test))) errors.push('Each contract-change classification needs a reason and existing tests.');
    if (item.kind === 'contract' && valid && compareSchemaVersions(item.targetVersion, item.baseVersion) <= 0) errors.push('A semantic contract change requires a schema version increment.');
  }
  return errors;
}

/** The gate executes these suites, including future tests outside the usual API suite. */
export function migrationTestPaths(state: EvolutionState): string[] {
  return [...new Set([...state.steps.flatMap(step => step.tests), ...state.declarations.flatMap(item => item.tests)])];
}
