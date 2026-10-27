import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION, decodeStoredSpec } from '@adventure/spec-v3';
import { MemoryV3PlayStore } from '@/lib/play/v3/store';
import { MemoryUpgradeRepository } from '@/lib/v3/upgrades/repository';
import { startUpgrade, applyUpgrade } from '@/lib/v3/upgrades/service';
import { prepareUpgrade } from '@/lib/v3/upgrades/migrate';
import { preparationAdventure } from '../fixtures/v3-preparation';
function fixture(schemaVersion: 1 | 2) {
    const { spec } = preparationAdventure();
    spec.schemaVersion = schemaVersion;
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
    spec.authoring = {
        importId: '12345678-1234-4234-8234-123456789012'
    };
    const store = new MemoryV3PlayStore();
    store.addAdventure({
        id: 'a',
        schoolId: 's',
        ownerId: 'u',
        status: 'published',
        specVersion: 1,
        publishedVersion: 1,
        spec
    });
    const repository = new MemoryUpgradeRepository(store);
    let calls = 0;
    const deps = {
        store,
        repository,
        env: {
            V3_ENABLED: '1',
            V3_SCHOOL_IDS: 's'
        },
        enqueue: async () => {
        },
        llm: () => {
            calls++;
            throw Error('Structural upgrades do not use a model');
        }
    };
    return {
        spec,
        store,
        repository,
        deps,
        calls: () => calls
    };
}
describe('import metadata schema upgrade', () => {
    it('upgrades schema 2 to the latest version without model calls or content changes', async () => {
        const { deps, spec, store, calls } = fixture(2);
        const started = await startUpgrade(deps, 'u', 'a', {
            expectedRevision: 1
        });
        if (!started.ok)
            throw Error(started.message);
        const ready = await prepareUpgrade(deps, started.run);
        expect(ready?.status).toBe('ready');
        const decoded = decodeStoredSpec(spec);
        if (!decoded.ok)
            throw Error('Invalid fixture');
        expect(ready?.candidate).toEqual({
            ...decoded.spec,
            schemaVersion: CURRENT_SCHEMA_VERSION
        });
        expect(calls()).toBe(0);
        const applied = await applyUpgrade(deps, 'u', 'a', {
            runId: started.run.id,
            proposalRevision: 1
        });
        expect(applied.ok).toBe(true);
        expect(await store.loadVersionSpec('a', 1)).toEqual(spec);
        expect(await store.loadVersionSpec('a', 2)).toMatchObject({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id: spec.id,
            authoring: {
                importId: spec.authoring?.importId
            }
        });
        expect((await store.loadAdventure('a'))?.publishedVersion).toBe(1);
    });
    it('runs the complete legacy to preparation to import-metadata chain and applies only one draft revision', async () => {
        const { deps, spec, store, calls } = fixture(1);
        const started = await startUpgrade(deps, 'u', 'a', {
            expectedRevision: 1
        });
        if (!started.ok)
            throw Error(started.message);
        const ready = await prepareUpgrade(deps, started.run);
        expect(ready?.status).toBe('ready');
        expect(ready?.migrationState).toMatchObject({
            completed: [{
                    stepId: 'evidence-preparation',
                    candidate: {
                        schemaVersion: '2.0.0'
                    }
                }, {
                    stepId: 'import-metadata',
                    candidate: { schemaVersion: '2.1.0' }
                }, { stepId: 'reading-text', candidate: { schemaVersion: CURRENT_SCHEMA_VERSION } }]
        });
        expect(calls()).toBe(0);
        const applied = await applyUpgrade(deps, 'u', 'a', {
            runId: started.run.id,
            proposalRevision: 1
        });
        expect(applied.ok).toBe(true);
        expect((await store.loadAdventure('a'))?.specVersion).toBe(2);
        expect(await store.loadVersionSpec('a', 2)).toMatchObject({
            documents: spec.documents,
            stages: spec.stages,
            authoring: {
                importId: spec.authoring?.importId
            }
        });
    });
});
describe('historical queued upgrades', () => {
    it('applies an already-reviewed integer-marker proposal pinned to 2.0.0', async () => {
        const { deps, spec, store } = fixture(1);
        const started = await startUpgrade(deps, 'u', 'a', {
            expectedRevision: 1
        });
        if (!started.ok)
            throw Error(started.message);
        const { preserveUpgradeMedia } = await import('@/lib/v3/upgrades/preservation');
        const candidate = {
            ...preserveUpgradeMedia(spec, 'a', 1),
            schemaVersion: 2 as const
        };
        const historical = {
            ...started.run,
            id: 'historical-ready',
            targetSchemaVersion: '2.0.0',
            status: 'ready' as const,
            candidate,
            migrationState: {
                completed: [{
                        stepId: 'evidence-preparation',
                        source: spec,
                        candidate
                    }]
            }
        };
        await deps.repository.create(historical);
        const applied = await applyUpgrade(deps, 'u', 'a', {
            runId: historical.id,
            proposalRevision: 1
        });
        expect(applied.ok).toBe(true);
        expect(await store.loadVersionSpec('a', 2)).toEqual(candidate);
    });
    it('resumes a queued upgrade at its pinned historic target without silently adding a newer step', async () => {
        const { deps } = fixture(1);
        const started = await startUpgrade(deps, 'u', 'a', {
            expectedRevision: 1
        });
        if (!started.ok)
            throw Error(started.message);
        const historical = {
            ...started.run,
            id: 'historical-running',
            targetSchemaVersion: '2.0.0'
        };
        await deps.repository.create(historical);
        const ready = await prepareUpgrade(deps, historical);
        expect(ready?.status).toBe('ready');
        expect(ready?.candidate).toMatchObject({
            schemaVersion: '2.0.0'
        });
        expect(ready?.migrationState).toMatchObject({
            completed: [{
                    stepId: 'evidence-preparation'
                }]
        });
    });
});
