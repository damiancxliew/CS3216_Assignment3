import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryV3PlayStore } from '@/lib/play/v3/store';
import { publishAdventure, unpublishAdventure, loadJoinView } from '@/lib/play/v3/publish';
import { createAttempt } from '@/lib/play/v3/service';

describe('versioned publication', () => {
  function setup() {
    const spec = JSON.parse(readFileSync('fixtures/golden-1819.json', 'utf8'));
    const store = new MemoryV3PlayStore();
    store.addAdventure({ id: 'a', ownerId: 'teacher', schoolId: 's', status: 'draft', specVersion: 1, spec });
    for (const id of ['teacher', 'A', 'B', 'C']) store.addMember('s', id);
    const deps = { store, env: { V3_ENABLED: 'true', V3_SCHOOL_IDS: 's' }, now: () => 0, llm: () => { throw Error('Unexpected model call'); } };
    return { spec, store, deps };
  }
  it('keeps A and B on v1 through saving and publishing v2; C starts v2', async () => {
    const { spec, store, deps } = setup();
    await publishAdventure(deps, 'teacher', 'a', { version: 1, publishedVersion: null });
    const a = await createAttempt(deps, 'A', 'a');
    expect(await store.saveDraft('a', 1, { ...spec, title: 'Edited' })).toEqual({ saved: true, version: 2 });
    expect((await loadJoinView(deps, 'B', 'a'))).toMatchObject({ title: spec.title });
    const b = await createAttempt(deps, 'B', 'a');
    expect((await store.loadAttempt(b.body.attemptId as string))?.specVersion).toBe(1);
    expect((await publishAdventure(deps, 'teacher', 'a', { version: 2, publishedVersion: 1 })).status).toBe(200);
    const c = await createAttempt(deps, 'C', 'a');
    expect((await store.loadAttempt(c.body.attemptId as string))?.specVersion).toBe(2);
    expect((await store.loadAttempt(a.body.attemptId as string))?.specVersion).toBe(1);
    expect((await createAttempt(deps, 'B', 'a')).body).toMatchObject({ attemptId: b.body.attemptId, resumed: true });
  });
  it('rejects stale save/publication and does not snapshot unchanged saves', async () => {
    const { spec, store, deps } = setup();
    expect(await store.saveDraft('a', 1, spec)).toEqual({ saved: true, version: 1 });
    await store.saveDraft('a', 1, { ...spec, title: 'Changed' });
    expect(await store.saveDraft('a', 1, spec)).toEqual({ saved: false });
    expect((await publishAdventure(deps, 'teacher', 'a', { version: 1, publishedVersion: null })).status).toBe(409);
    await publishAdventure(deps, 'teacher', 'a', { version: 2, publishedVersion: null });
    expect((await unpublishAdventure(deps, 'teacher', 'a', { version: 2, publishedVersion: null })).status).toBe(409);
  });
  it('reinitializes when publication changes during state initialization', async () => {
    const { spec, store, deps } = setup();
    await publishAdventure(deps, 'teacher', 'a');
    const original = store.createAttempt.bind(store);
    let raced = false;
    store.createAttempt = async input => {
      if (!raced) {
        raced = true;
        await store.saveDraft('a', 1, { ...spec, title: 'Raced' });
        await store.publishVersion('a', 2, 1, true);
      }
      return original(input);
    };
    const result = await createAttempt(deps, 'A', 'a');
    expect(result.status).toBe(201);
    expect((await store.loadAttempt(result.body.attemptId as string))?.specVersion).toBe(2);
  });
});

it('keeps issued release links pinned and reuses the same link rather than minting another', async () => {
  const spec = JSON.parse(readFileSync('fixtures/golden-1819.json', 'utf8'));
  const store = new MemoryV3PlayStore();
  store.addAdventure({ id: 'a', ownerId: 'teacher', schoolId: 's', status: 'draft', specVersion: 1, spec });
  for (const id of ['teacher', 'A', 'B', 'C']) store.addMember('s', id);
  const deps = { store, env: { V3_ENABLED: 'true', V3_SCHOOL_IDS: 's' }, now: () => 0, llm: () => { throw Error('Unexpected model call'); } };
  await publishAdventure(deps, 'teacher', 'a');
  const first = (await store.listPublications('a'))[0];
  await store.saveDraft('a', 1, { ...spec, title: 'Second release' });
  await publishAdventure(deps, 'teacher', 'a');
  const second = (await store.listPublications('a')).find(p => p.version === 2)!;
  expect(first.linkKey).not.toBe(second.linkKey);
  const oldStart = await createAttempt(deps, 'A', 'a', first.linkKey);
  expect((await store.loadAttempt(oldStart.body.attemptId as string))?.specVersion).toBe(1);
  const newStart = await createAttempt(deps, 'A', 'a', second.linkKey);
  expect((await store.loadAttempt(newStart.body.attemptId as string))?.specVersion).toBe(2);
  expect((await loadJoinView(deps, 'B', 'a', first.linkKey))).toMatchObject({ title: spec.title });
  expect((await createAttempt(deps, 'B', 'a', 'unknown')).status).toBe(404);
  await publishAdventure(deps, 'teacher', 'a');
  expect((await store.listPublications('a')).find(p => p.version === 1)?.linkKey).toBe(first.linkKey);
  expect(await store.publishVersion('a', 1, 2, true)).toBe(false);
  expect(await store.listPublications('a')).toHaveLength(2);
  await unpublishAdventure(deps, 'teacher', 'a');
  expect((await createAttempt(deps, 'B', 'a', first.linkKey)).status).toBe(409);
});
