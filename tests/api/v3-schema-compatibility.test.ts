import { publishedVersionId } from "../fixtures/v3-publication";
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AdventureSpec } from '@adventure/spec-v3';
import { FakeLlmClient } from '@adventure/orchestration';
import { createAttempt, getAttempt, postAction, type V3PlayServiceDeps } from '@/lib/play/v3/service';
import { MemoryV3PlayStore } from '@/lib/play/v3/store';

function setup(spec: unknown) {
  const store = new MemoryV3PlayStore();
  store.addAdventure({ id: 'game', ownerId: 'teacher', schoolId: 'school', status: 'published', specVersion: 1, spec });
  store.addMember('school', 'student');
  const deps: V3PlayServiceDeps = { store, llm: () => new FakeLlmClient(), now: () => 1000, env: {} };
  return { store, deps };
}
const legacy = () => AdventureSpec.parse(JSON.parse(readFileSync('fixtures/golden-1819.json', 'utf8')));
describe('version-aware play storage boundary', () => {
  it('returns an actionable error for unsupported published formats without creating an attempt', async () => {
    const { deps, store } = setup({ ...legacy(), schemaVersion: 99 });
    const response = await createAttempt(deps, 'student', await publishedVersionId(deps.store, 'game'));
    expect(response).toMatchObject({ status: 409, body: { error: { code: 'schema_upgrade_required' } } });
    expect(await store.findLatestAttempt('game', 'student', 1)).toBeNull();
  });
  it('resumes legacy content without rewriting the pinned publication', async () => {
    const spec = legacy();
    const { deps, store } = setup(spec);
    const started = await createAttempt(deps, 'student', await publishedVersionId(deps.store, 'game'));
    expect(started.status).toBe(201);
    expect((await getAttempt(deps, 'student', started.body.attemptId as string)).status).toBe(200);
    expect(await store.loadVersionSpec('game', 1)).toEqual(spec);
  });
  it('does not mutate saved progress when a pinned format cannot be read', async () => {
    const { deps, store } = setup(legacy());
    const started = await createAttempt(deps, 'student', await publishedVersionId(deps.store, 'game'));
    const attemptId = started.body.attemptId as string;
    const before = await store.loadAttempt(attemptId);
    const load = store.loadVersionSpec.bind(store);
    store.loadVersionSpec = async (id, version) => ({ ...await load(id, version) as object, schemaVersion: 99 });
    expect((await getAttempt(deps, 'student', attemptId)).status).toBe(409);
    expect((await postAction(deps, 'student', attemptId, { revision: 0, action: { type: 'continue' } })).status).toBe(409);
    expect(await store.loadAttempt(attemptId)).toEqual(before);
  });
});
