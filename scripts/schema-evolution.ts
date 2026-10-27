export type EvolutionDeclaration = {
  baseVersion: number;
  targetVersion: number;
  kind: 'contract' | 'implementation';
  reason: string;
  tests: string[];
};
export type EvolutionState = {
  current: number;
  snapshots: Record<string, string>;
  emitted: Record<string, string>;
  steps: { id: string; from: number; to: number; tests: string[] }[];
  declarations: EvolutionDeclaration[];
};

/** Pure checks, shared by CI and negative regression tests. */
export function evolutionIssues(next: EvolutionState, base: EvolutionState | undefined, changed: string[], exists: (path: string) => boolean): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(next.current) || next.current < 1) return ['The current schema version must be a positive integer.'];
  for (let version = 1; version <= next.current; version++) {
    if (!next.snapshots[version] || next.snapshots[version] !== next.emitted[version]) errors.push(`Schema ${version} does not match its checked-in snapshot.`);
    if (base?.snapshots[version] && base.snapshots[version] !== next.snapshots[version]) errors.push(`Released schema ${version} is immutable. Add a new version and upgrade path.`);
    let at = version;
    while (at < next.current) {
      const outgoing = next.steps.filter(step => step.from === at);
      if (outgoing.length !== 1 || outgoing[0]!.to !== at + 1) {
        errors.push(`Schema ${version} has a missing or ambiguous migration route to ${next.current}.`);
        break;
      }
      at = outgoing[0]!.to;
    }
  }
  const ids = new Set<string>();
  for (const step of next.steps) {
    if (ids.has(step.id)) errors.push(`Duplicate migration ${step.id}.`);
    ids.add(step.id);
    if (!Number.isSafeInteger(step.from) || !Number.isSafeInteger(step.to) || step.from < 1 || step.to !== step.from + 1 || step.to > next.current) errors.push(`Invalid migration ${step.id}.`);
    if (!step.tests.length || step.tests.some(test => !test.endsWith('.test.ts') || !exists(test))) errors.push(`Migration ${step.id} needs an existing migration test.`);
  }
  if (base) {
    if (next.current < base.current) errors.push('The current schema version cannot decrease.');
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
    if (!Number.isSafeInteger(item.baseVersion) || !Number.isSafeInteger(item.targetVersion) || item.baseVersion < 1 || item.targetVersion < item.baseVersion || item.targetVersion > next.current) errors.push('Each classification must name valid source and target schema versions.');
    if (!item.reason.trim() || !item.tests.length || item.tests.some(test => !exists(test))) errors.push('Each contract-change classification needs a reason and existing tests.');
    if (item.kind === 'contract' && item.targetVersion <= item.baseVersion) errors.push('A semantic contract change requires a schema version increment.');
  }
  return errors;
}

/** The gate executes these suites, including future tests outside the usual API suite. */
export function migrationTestPaths(state: EvolutionState): string[] {
  return [...new Set([...state.steps.flatMap(step => step.tests), ...state.declarations.flatMap(item => item.tests)])];
}
