import { isDeepStrictEqual } from 'node:util';
import type { CheckIssue, UpgradeDescriptor } from '@adventure/spec-v3';

type Versioned = { schemaVersion?: number };
export type UpgradeCheckpoint<T> = {
  completed: { stepId: string; source: T; candidate: T }[];
  active?: { stepId: string; source: T; candidate: T };
};
export type UpgradeStepHandler<T> = {
  kind: UpgradeDescriptor['kind'];
  run(input: { step: UpgradeDescriptor; source: T; candidate: T }): Promise<{ candidate: T; complete: boolean; findings: CheckIssue[] }>;
  preserves(source: T, candidate: T): boolean;
};
export type UpgradeRunnerInput<T> = {
  source: T;
  path: readonly UpgradeDescriptor[];
  handlers: Readonly<Record<string, UpgradeStepHandler<T>>>;
  checkpoint?: UpgradeCheckpoint<T>;
  validate(version: number, candidate: T): CheckIssue[];
  onCheckpoint?(checkpoint: UpgradeCheckpoint<T>): Promise<void>;
};
export type UpgradeValidationInput<T> = Omit<UpgradeRunnerInput<T>, 'handlers' | 'onCheckpoint'> & {
  handlers: Readonly<Record<string, Pick<UpgradeStepHandler<T>, 'kind' | 'preserves'>>>;
};
export type UpgradeRunnerResult<T> = {
  status: 'ready' | 'paused' | 'blocked';
  candidate: T;
  checkpoint: UpgradeCheckpoint<T>;
  findings: CheckIssue[];
};
const issue = (message: string): CheckIssue => ({ code: 'upgrade-checkpoint', path: '', message });
const version = (candidate: Versioned): number => candidate.schemaVersion ?? 1;

function checkPath<T extends Versioned>(input: UpgradeValidationInput<T>): void {
  let at = version(input.source);
  const seen = new Set<string>();
  for (const step of input.path) {
    if (step.from !== at || !Number.isSafeInteger(step.to) || step.to <= at || seen.has(step.id)) throw Error('The migration path does not follow the source schema version.');
    const handler = input.handlers[step.id];
    if (!handler || handler.kind !== step.kind) throw Error(`No matching ${step.kind} handler is registered for ${step.id}.`);
    at = step.to;
    seen.add(step.id);
  }
}

/** Replay completed steps without model calls before reusing or applying persisted work. */
export function validateUpgradeCheckpoint<T extends Versioned>(input: UpgradeValidationInput<T>): CheckIssue[] {
  checkPath(input);
  const checkpoint = input.checkpoint;
  if (!checkpoint) return [];
  if (checkpoint.completed.length > input.path.length) return [issue('The checkpoint contains steps outside the requested upgrade path.')];
  let source = input.source;
  for (let index = 0; index < checkpoint.completed.length; index++) {
    const recorded = checkpoint.completed[index]!, step = input.path[index]!;
    if (recorded.stepId !== step.id || !isDeepStrictEqual(source, recorded.source) || version(recorded.candidate) !== step.to) return [issue('The completed migration history does not match its source or target version.')];
    if (!input.handlers[step.id]!.preserves(structuredClone(source), structuredClone(recorded.candidate))) return [issue(`Upgrade ${step.id} changed protected content.`)];
    const findings = input.validate(step.to, recorded.candidate);
    if (findings.length) return findings;
    source = recorded.candidate;
  }
  if (checkpoint.active) {
    const next = input.path[checkpoint.completed.length];
    if (!next || checkpoint.active.stepId !== next.id || !isDeepStrictEqual(source, checkpoint.active.source) || version(checkpoint.active.candidate) !== next.from) return [issue('The partial migration checkpoint does not match the next upgrade step.')];
  }
  return [];
}

/** Run one version at a time. A handler owns its task checkpoints; this runner owns version transitions. */
export async function runUpgradePath<T extends Versioned>(input: UpgradeRunnerInput<T>): Promise<UpgradeRunnerResult<T>> {
  checkPath(input);
  const checkpoint: UpgradeCheckpoint<T> = structuredClone(input.checkpoint ?? { completed: [] });
  const invalid = validateUpgradeCheckpoint({ ...input, checkpoint });
  let source = checkpoint.completed.at(-1)?.candidate ?? structuredClone(input.source);
  if (invalid.length) return { status: 'blocked', candidate: source, checkpoint, findings: invalid };
  for (let index = checkpoint.completed.length; index < input.path.length; index++) {
    const step = input.path[index]!, handler = input.handlers[step.id]!;
    const starting = checkpoint.active?.candidate ?? source;
    const output = await handler.run({ step, source: structuredClone(source), candidate: structuredClone(starting) });
    const partial = { ...output.candidate, schemaVersion: step.from };
    checkpoint.active = { stepId: step.id, source: structuredClone(source), candidate: partial };
    const candidate = { ...output.candidate, schemaVersion: step.to };
    const findings = [...output.findings];
    if (output.complete && !findings.length) {
      if (!handler.preserves(structuredClone(source), structuredClone(candidate))) findings.push(issue(`Upgrade ${step.id} changed protected content.`));
      findings.push(...input.validate(step.to, candidate));
    }
    if (!output.complete || findings.length) {
      await input.onCheckpoint?.(structuredClone(checkpoint));
      return { status: findings.length ? 'blocked' : 'paused', candidate: partial, checkpoint, findings };
    }
    checkpoint.completed.push({ stepId: step.id, source: structuredClone(source), candidate: structuredClone(candidate) });
    delete checkpoint.active;
    await input.onCheckpoint?.(structuredClone(checkpoint));
    source = candidate;
  }
  return { status: 'ready', candidate: source, checkpoint, findings: [] };
}
