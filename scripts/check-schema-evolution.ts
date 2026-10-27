import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { CURRENT_SCHEMA_VERSION, SCHEMA_REGISTRY, UPGRADE_REGISTRY, getSchemaSnapshot } from '../packages/spec-v3/src/index';
import { evolutionIssues, migrationTestPaths, type EvolutionDeclaration, type EvolutionState } from './schema-evolution';

const manifestPath = 'packages/spec-v3/schema/evolution.json';
type Manifest = { migrations: { id: string; from: number; to: number; tests: string[] }[]; declarations: EvolutionDeclaration[] };
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const next: EvolutionState = {
  current: CURRENT_SCHEMA_VERSION,
  snapshots: Object.fromEntries(SCHEMA_REGISTRY.map(({ version }) => [version, canonical(JSON.parse(readFileSync(`packages/spec-v3/schema/${version}.schema.json`, 'utf8')))])),
  emitted: Object.fromEntries(SCHEMA_REGISTRY.map(({ version }) => [version, canonical(getSchemaSnapshot(version))])),
  steps: UPGRADE_REGISTRY.map(step => ({ ...step, tests: manifest.migrations.find(item => item.id === step.id && item.from === step.from && item.to === step.to)?.tests ?? [] })),
  declarations: manifest.declarations,
};
let base: EvolutionState | undefined;
let changed: string[] = [];
const baseRef = process.env.SCHEMA_BASE_REF;
if (baseRef) {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  changed = git('diff', '--name-only', `${baseRef}...HEAD`).trim().split('\n');
  const paths = git('ls-tree', '-r', '--name-only', baseRef, 'packages/spec-v3/schema').trim().split('\n');
  if (paths.includes(manifestPath)) {
    const previous: Manifest = JSON.parse(git('show', `${baseRef}:${manifestPath}`));
    const snapshots = Object.fromEntries(paths.filter(path => /\/\d+\.schema\.json$/.test(path)).map(path => [path.split('/').at(-1)!.split('.')[0]!, canonical(JSON.parse(git('show', `${baseRef}:${path}`)))]));
    base = { current: Math.max(...Object.keys(snapshots).map(Number)), snapshots, emitted: snapshots, steps: previous.migrations, declarations: previous.declarations };
  }
}
const errors = evolutionIssues(next, base, changed, existsSync);
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  // A manifest entry must execute successfully, rather than merely name an existing file.
  execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...migrationTestPaths(next)], { stdio: 'inherit' });
  console.log(`Schema evolution verified: ${SCHEMA_REGISTRY.length} versions, ${UPGRADE_REGISTRY.length} reviewed upgrade path(s).`);
}
