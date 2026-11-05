import { CURRENT_SCHEMA_VERSION } from '@adventure/spec-v3';
import { prepareUpgrade } from '@/lib/v3/upgrades/migrate';
import { describe, expect, it } from "vitest";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { MemoryUpgradeRepository } from "@/lib/v3/upgrades/repository";
import { startUpgrade, getUpgrade, applyUpgrade, discardUpgrade, refineUpgrade } from "@/lib/v3/upgrades/service";
import { preserveUpgradeMedia } from '@/lib/v3/upgrades/preservation';
import { preparationAdventure } from "../fixtures/v3-preparation";
function fixture() {
    const store = new MemoryV3PlayStore();
    const { spec } = preparationAdventure();
    spec.characters.forEach(c => c.trustNotice = 'Claims need support.');
    spec.openQuestions = [{
            id: 'oq',
            stageId: spec.stages[0]!.id,
            text: 'Which concern matters?',
            discoveryIds: ['disc-1']
        }];
    spec.hintAngles = [{
            id: 'hint',
            discoveryId: 'disc-1',
            kind: 'ask',
            text: 'Ask about trade.'
        }];
    spec.endings.forEach(e => {
        e.epilogue = 'Your simulation: ' + e.epilogue;
        e.interview.verdicts.forEach(v => v.counterPoints = ['disc-1']);
    });
    store.addAdventure({
        id: 'a',
        ownerId: 'teacher',
        schoolId: 'school',
        status: 'published',
        specVersion: 1,
        publishedVersion: 1,
        spec
    });
    const repository = new MemoryUpgradeRepository(store);
    const queue: unknown[] = [];
    const deps = {
        store,
        repository,
        env: {},
        enqueue: async (...args: unknown[]) => {
            queue.push(args);
        }
    };
    return {
        deps,
        store,
        repository,
        queue,
        spec
    };
}
describe('reviewed schema upgrades', () => {
    it('denies unauthorized starts without creating runs', async () => {
        const { deps, queue } = fixture();
        expect((await startUpgrade(deps, 'outsider', 'a', {
            expectedRevision: 1
        })).ok).toBe(false);
        expect(queue).toHaveLength(0);
    });
    it('deduplicates starts, preserves publications, and rejects stale starts', async () => {
        const { deps, queue, store } = fixture();
        const first = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        expect(first.ok).toBe(true);
        const second = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        expect(second).toEqual(first);
        expect(queue).toHaveLength(1);
        expect((await store.loadAdventure('a'))?.publishedVersion).toBe(1);
        expect((await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 2
        })).ok).toBe(false);
    });
    it('requires ready proposal and exact revision for apply, then applies once', async () => {
        const { deps, store } = fixture();
        const first = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!first.ok)
            throw Error(first.message);
        expect((await applyUpgrade(deps, 'teacher', 'a', {
            runId: first.run.id,
            proposalRevision: 1
        })).ok).toBe(false);
        await prepareUpgrade({
            ...deps,
            llm: () => { throw Error('No model call expected'); },
        }, first.run);
        const result = await applyUpgrade(deps, 'teacher', 'a', {
            runId: first.run.id,
            proposalRevision: 1
        });
        expect(result.ok).toBe(true);
        expect(await applyUpgrade(deps, 'teacher', 'a', {
            runId: first.run.id,
            proposalRevision: 1
        })).toEqual(result);
        expect((await store.loadAdventure('a'))?.specVersion).toBe(2);
        expect((await store.loadAdventure('a'))?.publishedVersion).toBe(1);
    });
    it('invalidates proposals after saved edits and refuses further work', async () => {
        const { deps, store, spec } = fixture();
        const first = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!first.ok)
            throw Error(first.message);
        await store.saveDraft('a', 1, {
            ...spec,
            title: 'Changed'
        });
        const read = await getUpgrade(deps, 'teacher', 'a', first.run.id);
        expect(read?.ok && read.run.status).toBe('stale');
        expect((await refineUpgrade(deps, 'teacher', 'a', {
            runId: first.run.id,
            proposalRevision: 1,
            instruction: 'Try again'
        })).ok).toBe(false);
    });
    it('discard is terminal and inaccessible across adventures', async () => {
        const { deps } = fixture();
        const first = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!first.ok)
            throw Error(first.message);
        expect((await discardUpgrade(deps, 'teacher', 'a', {
            runId: first.run.id,
            proposalRevision: 1
        })).ok).toBe(true);
        expect((await getUpgrade(deps, 'teacher', 'other', first.run.id))?.ok).toBe(false);
        expect((await refineUpgrade(deps, 'teacher', 'a', {
            runId: first.run.id,
            proposalRevision: 1,
            instruction: ''
        })).ok).toBe(false);
    });
});
describe('proposal concurrency and preservation', () => {
    it('rejects candidate source rewrites and semantic failures even when marked ready', async () => {
        const { deps, repository, spec } = fixture();
        const start = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!start.ok)
            throw Error(start.message);
        const candidate = {
            ...preserveUpgradeMedia(spec, 'a', 1),
            schemaVersion: CURRENT_SCHEMA_VERSION,
            title: 'Tampered'
        };
        await repository.update(start.run.id, 1, {
            status: 'ready',
            candidate,
            migrationState: {
                completed: [{
                        stepId: 'evidence-preparation',
                        source: spec,
                        candidate
                    }]
            }
        });
        const result = await applyUpgrade(deps, 'teacher', 'a', {
            runId: start.run.id,
            proposalRevision: 1
        });
        expect(result.ok).toBe(false);
        if (result.ok === false)
            expect(result.message).toContain('preserve');
    });
    it('a stale worker cannot overwrite a newer checkpoint', async () => {
        const { deps, repository } = fixture();
        const start = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!start.ok)
            throw Error(start.message);
        const first = await repository.update(start.run.id, 1, {
            progress: {
                completed: 1,
                total: 2,
                label: 'One'
            }
        }, 0);
        expect(first?.progress.completed).toBe(1);
        expect(await repository.update(start.run.id, 1, {
            progress: {
                completed: 0,
                total: 2,
                label: 'Old'
            }
        }, 0)).toBeNull();
        expect((await repository.get(start.run.id))?.progress.completed).toBe(1);
    });
    it('refinement increments revision and rejects stale apply and duplicate refine', async () => {
        const { deps, repository } = fixture();
        const start = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!start.ok)
            throw Error(start.message);
        await repository.update(start.run.id, 1, {
            status: 'blocked'
        });
        const results = await Promise.all([0, 1].map(() => refineUpgrade(deps, 'teacher', 'a', {
            runId: start.run.id,
            proposalRevision: 1,
            instruction: 'Improve the question'
        })));
        expect(results.filter(r => r.ok)).toHaveLength(1);
        const stale = await applyUpgrade(deps, 'teacher', 'a', {
            runId: start.run.id,
            proposalRevision: 1
        });
        expect(stale.ok).toBe(false);
    });
});
describe('future-step refinement policy', () => {
    it('reopens the earliest content migration and invalidates dependent outputs', async () => {
        const { reopenUpgradeCheckpoint } = await import('@/lib/v3/upgrades/service');
        const path = [{
                id: 'rename',
                from: '1.0.0',
                to: '2.0.0',
                kind: 'structural' as const,
                title: 'Rename',
                summary: 'Rename',
                requirements: []
            }, {
                id: 'questions',
                from: '2.0.0',
                to: '3.0.0',
                kind: 'content' as const,
                title: 'Questions',
                summary: 'Questions',
                requirements: []
            }, {
                id: 'followup',
                from: '3.0.0',
                to: '4.0.0',
                kind: 'content' as const,
                title: 'Followup',
                summary: 'Followup',
                requirements: []
            }];
        const completed = path.map((p, index) => ({
            stepId: p.id,
            source: {
                schemaVersion: p.from,
                value: index
            },
            candidate: {
                schemaVersion: p.to,
                value: index + 1
            }
        }));
        const refined = reopenUpgradeCheckpoint({
            completed
        }, path, true);
        expect(refined?.completed.map(s => s.stepId)).toEqual(['rename']);
        expect(refined?.active).toMatchObject({
            stepId: 'questions',
            candidate: {
                schemaVersion: '2.0.0',
                value: 2
            }
        });
        const retry = reopenUpgradeCheckpoint({
            completed
        }, path, false);
        expect(retry?.completed.map(s => s.stepId)).toEqual(['rename', 'questions']);
        expect(retry?.active?.stepId).toBe('followup');
    });
    it('refuses discarding a proposal reserved by an atomic apply', async () => {
        const { store, repository, spec, deps } = fixture();
        const start = await startUpgrade(deps, 'teacher', 'a', {
            expectedRevision: 1
        });
        if (!start.ok)
            throw Error(start.message);
        await repository.update(start.run.id, 1, {
            status: 'ready',
            candidate: spec
        });
        let complete!: (value: {
            saved: boolean;
            version: number;
        }) => void;
        const oldSave = store.saveDraft.bind(store);
        store.saveDraft = async () => await new Promise(resolve => {
            complete = resolve;
        });
        const applying = repository.apply(start.run.id, 1);
        expect(await repository.update(start.run.id, 1, {
            status: 'discarded'
        })).toBeNull();
        complete({
            saved: true,
            version: 2
        });
        expect((await applying)?.status).toBe('applied');
        store.saveDraft = oldSave;
    });
});
