import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryV3PlayStore } from '@/lib/play/v3/store';
import { publishAdventure, unpublishAdventure, loadJoinView } from '@/lib/play/v3/publish';
import { createAttempt } from '@/lib/play/v3/service';
import { applyV3Edits } from '@/lib/v3/edit/commands';
import { resolveWalkingSprites } from '@/lib/v3/media/resolvers';
import { AdventureSpec } from '@adventure/spec-v3';

function setup() {
  const spec = AdventureSpec.parse(JSON.parse(readFileSync('fixtures/golden-1819.json', 'utf8')));
  const store = new MemoryV3PlayStore();
  store.addAdventure({ id: 'a', ownerId: 'teacher', schoolId: 's', status: 'draft', specVersion: 1, spec });
  for (const id of ['teacher', 'A', 'B', 'C']) store.addMember('s', id);
  const deps = { store, env: {}, now: () => 0, llm: () => { throw Error('Unexpected model call'); } };
  return { spec, store, deps };
}
describe('published version entry', () => {
  it('uses one ID per version and never resumes an attempt from another version', async () => {
    const { spec, store, deps } = setup();
    await publishAdventure(deps, 'teacher', 'a');
    const first = (await store.listPublications('a'))[0];
    const original = await createAttempt(deps, 'A', first.id);
    expect(original.status).toBe(201);
    const updated = applyV3Edits(spec, [{ type: 'walkingSprite', targetKey: 'player', selection: { kind: 'bundled', id: 'Noble' } }], []);
    await store.saveDraft('a', 1, { ...updated, title: 'New version' });
    expect(await store.publishVersion('a', 2, 1, true)).toBe(true);
    const second = (await store.listPublications('a')).find(p => p.version === 2)!;
    expect(second.id).not.toBe(first.id);
    expect(await loadJoinView(deps, 'A', second.id)).toMatchObject({ kind: 'ready', title: 'New version' });
    const newer = await createAttempt(deps, 'A', second.id);
    expect(newer.status).toBe(201);
    expect(newer.body.attemptId).not.toBe(original.body.attemptId);
    const attempt = (await store.loadAttempt(newer.body.attemptId as string))!;
    expect(attempt.specVersion).toBe(2);
    expect(resolveWalkingSprites(AdventureSpec.parse(await store.loadVersionSpec('a', attempt.specVersion))).player.sprite).toBe('Noble');
    expect((await createAttempt(deps, 'A', second.id)).body).toMatchObject({ attemptId: newer.body.attemptId, resumed: true });
    expect((await createAttempt(deps, 'A', first.id)).body).toMatchObject({ attemptId: original.body.attemptId, resumed: true });
    expect(await loadJoinView(deps, 'B', first.id)).toMatchObject({ title: spec.title });
    expect(await loadJoinView(deps, 'B', 'a')).toEqual({ kind: 'closed' });
    expect((await createAttempt(deps, 'B', 'a')).status).toBe(404);
    expect((await createAttempt(deps, 'B', 'unknown')).status).toBe(404);
    expect(await store.publishVersion('a', 2, 2, true)).toBe(true);
    expect((await store.listPublications('a')).find(p => p.version === 1)?.id).toBe(first.id);
    expect(await store.listPublications('a')).toHaveLength(2);
    await unpublishAdventure(deps, 'teacher', 'a');
    expect(await loadJoinView(deps, 'A', second.id)).toEqual({ kind: 'closed' });
    expect((await createAttempt(deps, 'A', second.id)).status).toBe(409);
  });
  it('keeps the requested version when the live pointer changes while starting', async () => {
    const { spec, store, deps } = setup();
    await publishAdventure(deps, 'teacher', 'a');
    const first = (await store.listPublications('a'))[0];
    const original = store.createAttempt.bind(store);
    store.createAttempt = async input => {
      await store.saveDraft('a', 1, { ...spec, title: 'Raced' });
      await store.publishVersion('a', 2, 1, true);
      return original(input);
    };
    const result = await createAttempt(deps, 'A', first.id);
    expect(result.status).toBe(201);
    expect((await store.loadAttempt(result.body.attemptId as string))?.specVersion).toBe(1);
  });
  it('rejects stale publication and leaves unchanged saves alone', async () => {
    const { spec, store, deps } = setup();
    expect(await store.saveDraft('a', 1, spec)).toEqual({ saved: true, version: 1 });
    await store.saveDraft('a', 1, { ...spec, title: 'Changed' });
    expect(await store.saveDraft('a', 1, spec)).toEqual({ saved: false });
    expect((await publishAdventure(deps, 'teacher', 'a', { version: 1, publishedVersion: null })).status).toBe(409);
  });
});
