import { describe, expect, it, vi } from 'vitest';
import { runUpgradePath, validateUpgradeCheckpoint, type UpgradeStepHandler } from '../../apps/web/src/lib/v3/upgrades/runner';
import type { UpgradeDescriptor } from '@adventure/spec-v3';

type Spec = { schemaVersion?: number; source: string; renamed?: string; question?: string };
const path: UpgradeDescriptor[] = [
  { id: 'rename', from: 1, to: 2, kind: 'structural', title: 'Rename', summary: 'Rename a field', requirements: [] },
  { id: 'question', from: 2, to: 3, kind: 'content', title: 'Question', summary: 'Add question', requirements: [] },
];
const source: Spec = { source: 'Historical source' };
const validate = (version: number, value: Spec) => {
  if (version >= 2 && value.renamed !== value.source || version >= 3 && !value.question) return [{ code: 'schema', path: '', message: 'Missing required content' }];
  return [];
};
const handlers = (): Record<string, UpgradeStepHandler<Spec>> => ({
  rename: { kind: 'structural', async run({ source }) { return { candidate: { ...source, renamed: source.source }, complete: true, findings: [] }; }, preserves: (a, b) => a.source === b.source },
  question: { kind: 'content', async run({ source }) { expect(source.schemaVersion).toBe(2); expect(source.renamed).toBe(source.source); return { candidate: { ...source, question: 'What changed?' }, complete: true, findings: [] }; }, preserves: (a, b) => a.source === b.source && a.renamed === b.renamed },
});

describe('versioned migration execution', () => {
  it('runs structural then content migrations against each intermediate version', async () => {
    const result = await runUpgradePath({ source, path, handlers: handlers(), validate });
    expect(result).toMatchObject({ status: 'ready', candidate: { schemaVersion: 3, source: source.source, renamed: source.source, question: 'What changed?' } });
    expect(result.checkpoint.completed.map(step => step.stepId)).toEqual(['rename', 'question']);
    expect(source).toEqual({ source: 'Historical source' });
  });
  it('pauses partial content without stamping a target and resumes without rerunning completed steps', async () => {
    const h = handlers();
    const rename = vi.spyOn(h.rename!, 'run');
    h.question!.run = vi.fn(async ({ candidate }) => ({ candidate: { ...candidate, question: 'Draft question' }, complete: false, findings: [] }));
    const first = await runUpgradePath({ source, path, handlers: h, validate });
    expect(first.status).toBe('paused');
    expect(first.candidate.schemaVersion).toBe(2);
    expect(first.checkpoint.active?.stepId).toBe('question');
    h.question!.run = vi.fn(async ({ candidate }) => { expect(candidate.question).toBe('Draft question'); return { candidate, complete: true, findings: [] }; });
    const result = await runUpgradePath({ source, path, handlers: h, validate, checkpoint: first.checkpoint });
    expect(result.status).toBe('ready');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(validateUpgradeCheckpoint({ source, path, handlers: h, validate, checkpoint: result.checkpoint })).toEqual([]);
  });
  it('blocks invalid intermediate output before a later model handler runs', async () => {
    const h = handlers();
    h.rename!.run = async () => ({ candidate: source, complete: true, findings: [] });
    const next = vi.spyOn(h.question!, 'run');
    const result = await runUpgradePath({ source, path, handlers: h, validate });
    expect(result.status).toBe('blocked');
    expect(result.findings).toContainEqual(expect.objectContaining({ code: 'schema' }));
    expect(next).not.toHaveBeenCalled();
    expect(result.candidate.schemaVersion).not.toBe(2);
  });
  it('uses each handler preservation contract and rejects tampered completed history', async () => {
    const h = handlers();
    const result = await runUpgradePath({ source, path, handlers: h, validate });
    result.checkpoint.completed[0]!.source.source = 'Rewritten source';
    expect(validateUpgradeCheckpoint({ source, path, handlers: h, validate, checkpoint: result.checkpoint }).length).toBeGreaterThan(0);
    h.rename!.run = async () => ({ candidate: { source: 'Rewritten source', renamed: 'Rewritten source' }, complete: true, findings: [] });
    expect((await runUpgradePath({ source, path, handlers: h, validate })).status).toBe('blocked');
  });
  it('retains blockers and validates handler kind and contiguous migration paths', async () => {
    const h = handlers();
    h.rename!.run = async () => ({ candidate: source, complete: false, findings: [{ code: 'gap', path: '', message: 'Teacher input needed' }] });
    expect((await runUpgradePath({ source, path, handlers: h, validate })).status).toBe('blocked');
    h.rename!.kind = 'content';
    await expect(runUpgradePath({ source, path, handlers: h, validate })).rejects.toThrow(/handler/i);
    await expect(runUpgradePath({ source, path: [path[1]!], handlers: handlers(), validate })).rejects.toThrow(/version|path/i);
  });
});
