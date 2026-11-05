import { cleanReadingDocument } from '@adventure/spec-v3';
import { describe, it, expect } from 'vitest';
import { FakeLlmClient } from '@adventure/generation/llm';
import { MemoryV3PlayStore } from '@/lib/play/v3/store';
import { MemoryUpgradeRepository } from '@/lib/v3/upgrades/repository';
import { startUpgrade } from '@/lib/v3/upgrades/service';
import { prepareUpgrade } from '@/lib/v3/upgrades/migrate';
import { preparationAdventure } from '../fixtures/v3-preparation';
async function fixture(remove = false) {
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
    const original = structuredClone(spec);
    if (remove) {
        delete spec.documents[0]!.readingCheck;
        delete spec.stages[0]!.preparation;
    }
    const store = new MemoryV3PlayStore();
    store.addAdventure({
        id: 'a',
        ownerId: 'u',
        schoolId: 's',
        specVersion: 1,
        status: 'draft',
        spec
    });
    const repository = new MemoryUpgradeRepository(store);
    const llm = new FakeLlmClient([]);
    const deps = {
        store,
        repository,
        llm: () => llm,
        enqueue: async () => {
        },
        env: {}
    };
    const result = await startUpgrade(deps, 'u', 'a', {
        expectedRevision: 1
    });
    if (!result.ok)
        throw Error(result.message);
    return {
        deps,
        run: result.run,
        original,
        llm,
        store
    };
}
describe('content migration', () => {
    it('preserves already-authored banks and preparation without model calls', async () => {
        const { deps, run, original, llm, store } = await fixture();
        const result = await prepareUpgrade(deps, run);
        expect(result?.status).toBe('ready');
        const candidate = result!.candidate as typeof original;
        expect(candidate.documents).toEqual(original.documents);
        expect(candidate.stages).toEqual(original.stages);
        expect(candidate.characters).toEqual(original.characters);
        expect(llm.requests).toHaveLength(0);
        expect((await store.loadAdventure('a'))?.specVersion).toBe(1);
    });
    it('adds only missing mechanics, converts exact quotes to source offsets, and validates', async () => {
        const { deps, run, original } = await fixture(true);
        const check = original.documents[0]!.readingCheck!;
        const body = original.documents[0]!.body;
        const convert = (q: typeof check.recovery) => {
            const { support, ...rest } = q;
            return {
                ...rest,
                supportQuotes: support.map(s => body.slice(s.start, s.end))
            };
        };
        const llm = new FakeLlmClient([{
                json: {
                    ...check,
                    variants: check.variants.map(convert),
                    recovery: convert(check.recovery)
                }
            }, {
                json: {
                    ...original.stages[0]!.preparation,
                    characters: Object.entries(original.stages[0]!.preparation!.characters).map(([characterId, groups]) => ({
                        characterId,
                        groups
                    }))
                }
            }]);
        deps.llm = () => llm;
        const result = await prepareUpgrade(deps, run);
        expect(result?.findings).toEqual([]);
        expect(result?.status).toBe('ready');
        const candidate = result?.candidate as typeof original;
        expect(candidate.documents).toEqual(original.documents);
        expect(candidate.stages).toEqual(original.stages);
        expect(llm.requests[0]!.system).not.toContain(body);
        expect(llm.requests).toHaveLength(2);
        expect(JSON.parse(llm.requests[1]!.user).task.triggers).toEqual(original.triggers);
        expect(JSON.parse(llm.requests[1]!.user).task.storyEvents).toEqual(original.storyEvents);
    });
    it('blocks missing evidence without modifying source or fabricating discoveries', async () => {
        const { deps, run, store } = await fixture(true);
        const raw = await store.loadVersionSpec('a', 1) as ReturnType<typeof preparationAdventure>['spec'];
        raw.discoveries = raw.discoveries.filter(d => !('documentId' in d.holder));
        store.addVersionSpec('a', 1, raw);
        const result = await prepareUpgrade(deps, run);
        expect(result?.status).toBe('blocked');
        expect(result?.findings.some(f => f.message.includes('no linked discovery'))).toBe(true);
        expect((result?.candidate as typeof raw).discoveries).toEqual(raw.discoveries);
    });
});
describe('checkpointed authoring', () => {
    it('resumes the next leased segment without regenerating completed questions', async () => {
        const { deps, run, original, store } = await fixture(true);
        const check = original.documents[0]!.readingCheck!;
        const body = original.documents[0]!.body;
        const quote = (q: typeof check.recovery) => {
            const { support, ...rest } = q;
            return {
                ...rest,
                supportQuotes: support.map(s => body.slice(s.start, s.end))
            };
        };
        const prep = original.stages[0]!.preparation!;
        const llm = new FakeLlmClient([{
                json: {
                    ...check,
                    variants: check.variants.map(quote),
                    recovery: quote(check.recovery)
                }
            }, {
                json: {
                    ...prep,
                    characters: Object.entries(prep.characters).map(([characterId, groups]) => ({
                        characterId,
                        groups
                    }))
                }
            }]);
        deps.llm = () => llm;
        const paused = await prepareUpgrade(deps, run, true);
        expect(paused?.status).toBe('running');
        expect(paused?.progress.completed).toBe(1);
        expect(llm.requests).toHaveLength(1);
        const ready = await prepareUpgrade(deps, paused!, true);
        expect(ready?.status).toBe('ready');
        expect(llm.requests).toHaveLength(2);
        expect((await store.loadAdventure('a'))?.specVersion).toBe(1);
    });
});
describe('upgrade worker', () => {
    it('rechecks staff access before model calls and skips superseded checkpoint inputs', async () => {
        const { deps, run, llm, store } = await fixture(true);
        const { upgradeSteps } = await import('@/lib/v3/upgrades/steps');
        const worker = upgradeSteps(() => deps)[0]!;
        const base = {
            jobId: run.id,
            name: 'part',
            outputs: {},
            attempt: 1,
            signal: new AbortController().signal
        };
        const stale = await worker.run({
            ...base,
            input: {
                runId: run.id,
                proposalRevision: 1,
                completed: 9,
                stepId: null
            }
        });
        expect(stale).toEqual({
            skipped: true
        });
        expect(llm.requests).toHaveLength(0);
        store.addAdventure({ ...(await store.loadAdventure('a'))!, ownerId: 'other-teacher' });
        await worker.run({
            ...base,
            input: {
                runId: run.id,
                proposalRevision: 1,
                completed: 0,
                stepId: null
            }
        });
        expect((await deps.repository.get(run.id))?.status).toBe('failed');
        expect(llm.requests).toHaveLength(0);
    });
});
describe('worker crash recovery', () => {
    it('requeues authoritative progress after a checkpoint survived a crashed worker', async () => {
        const { deps, run } = await fixture(true);
        await deps.repository.update(run.id, 1, {
            progress: {
                completed: 1,
                total: 2,
                label: 'Saved',
                stepId: 'evidence-preparation'
            }
        });
        const queued: unknown[] = [];
        deps.enqueue = async (...args: unknown[]) => {
            queued.push(args);
        };
        const { upgradeSteps } = await import('@/lib/v3/upgrades/steps');
        await upgradeSteps(() => deps)[0]!.run({
            jobId: run.id,
            name: 'first',
            outputs: {},
            attempt: 2,
            signal: new AbortController().signal,
            input: {
                runId: run.id,
                proposalRevision: 1,
                completed: 0,
                stepId: null
            }
        });
        expect(queued).toHaveLength(1);
        expect((queued[0] as [
            {
                progress: {
                    completed: number;
                };
            }
        ])[0].progress.completed).toBe(1);
    });
    it('a reviewed current candidate carries replayable immutable migration proof', async () => {
        const { deps, run, store } = await fixture();
        const result = await prepareUpgrade(deps, run);
        expect(result?.status).toBe('ready');
        const { applyUpgrade } = await import('@/lib/v3/upgrades/service');
        const applied = await applyUpgrade(deps, 'u', 'a', {
            runId: run.id,
            proposalRevision: 1
        });
        expect(applied.ok).toBe(true);
        expect((await store.loadAdventure('a'))?.specVersion).toBe(2);
    });
});
describe('production queue contract', () => {
    it('carries all checkpoint guards required by the registered worker', async () => {
        const { run } = await fixture();
        const { upgradeJobStep } = await import('@/lib/v3/upgrades/deps');
        const step = upgradeJobStep(run);
        expect(step.input).toEqual({
            runId: run.id,
            proposalRevision: 1,
            completed: 0,
            stepId: null
        });
        expect(step.step).toBe('v3.upgrade.prepare');
        const continued = upgradeJobStep({
            ...run,
            progress: {
                completed: 1,
                total: 2,
                label: 'Saved',
                stepId: 'evidence-preparation'
            }
        });
        expect(continued.name).not.toEqual(step.name);
        expect(continued.input).toMatchObject({
            completed: 1,
            stepId: 'evidence-preparation'
        });
    });
});
describe('migration registry completeness', () => {
    it('registers a matching runtime handler for every persisted upgrade capability', async () => {
        const { deps, run } = await fixture();
        const { UPGRADE_REGISTRY } = await import('@adventure/spec-v3');
        const { upgradeHandlers } = await import('@/lib/v3/upgrades/migrate');
        const handlers = upgradeHandlers(deps, run, false);
        for (const descriptor of UPGRADE_REGISTRY)
            expect(handlers[descriptor.id]?.kind).toBe(descriptor.kind);
    });
});
describe('grounded content safety', () => {
    it('bounds repair attempts and blocks fabricated supporting quotes without rewriting sources', async () => {
        const { deps, run, original } = await fixture(true);
        const check = original.documents[0]!.readingCheck!;
        const invalid = (q: typeof check.recovery) => {
            const { support: _, ...rest } = q;
            return {
                ...rest,
                supportQuotes: ['This sentence was invented.']
            };
        };
        const response = {
            ...check,
            variants: check.variants.map(invalid),
            recovery: invalid(check.recovery)
        };
        const llm = new FakeLlmClient(Array.from({
            length: 4
        }, () => ({
            json: response
        })));
        deps.llm = () => llm;
        const result = await prepareUpgrade(deps, run, true);
        expect(result?.status).toBe('blocked');
        expect(llm.requests).toHaveLength(4);
        expect((result?.candidate as typeof original).documents[0]?.body).toBe(original.documents[0]?.body);
        expect(result?.findings.some(f => f.message.includes('exact source'))).toBe(true);
    });
});
describe('deterministic upgrade behavior', () => {
    it('does not construct model clients when existing preparation is already valid', async () => {
        const { deps, run } = await fixture();
        deps.llm = () => {
            throw Error('No model credentials are configured');
        };
        expect((await prepareUpgrade(deps, run))?.status).toBe('ready');
    });
});

describe('line-wrapped source migration', () => {
    it('authors a check for a PDF-wrapped source and preserves its source passage and offsets', async () => {
        const { deps, run, original, store } = await fixture(true);
        const raw = await store.loadVersionSpec('a', 1) as typeof original;
        const doc = raw.documents[0]!;
        doc.body = 'PRESS RELEASE\n13 DECEMBER 2007\n\ni. a four-page letter from war-hero Lim Bo Seng to his wife after he had\nescaped from Singapore in 1942. A poignant letter to read, Lim\nmakes plain his commitment to ‘our war effort’, and ends by\nexpressing his hopes for his children’s education.\nii. a card entitled ‘Students Savings Scheme’ which recalls an era when\nschools cooperated with POSB (now POSBank) to promote the good\nhabit of saving.';
        doc.keyPassages = [{ id: doc.keyPassages[0]!.id, start: 35, end: 278 }];
        store.addVersionSpec('a', 1, raw);
        const check = original.documents[0]!.readingCheck!;
        const support = 'A poignant letter to read, Lim makes plain his commitment to ‘our war effort’, and ends by expressing his hopes for his children’s education.';
        const wire = (q: typeof check.recovery) => {
            const { support: _, ...rest } = q;
            return { ...rest, supportQuotes: [support] };
        };
        const prep = original.stages[0]!.preparation!;
        const llm = new FakeLlmClient([{ json: { ...check, variants: check.variants.map(wire), recovery: wire(check.recovery) } }, { json: { ...prep, characters: Object.entries(prep.characters).map(([characterId, groups]) => ({ characterId, groups })) } }]);
        deps.llm = () => llm;
        const result = await prepareUpgrade(deps, run);
        expect(result?.findings).toEqual([]);
        expect(result?.status).toBe('ready');
        const candidate = result!.candidate as typeof raw;
        expect(candidate.documents[0]!.body).toBe(cleanReadingDocument(doc).body);
        expect(candidate.documents[0]!.keyPassages).toEqual(doc.keyPassages);
        expect(candidate.documents[0]!.readingCheck!.variants[0]!.support).toEqual([{ start: 137, end: 278 }]);
        expect(JSON.parse(llm.requests[0]!.user).task.supportPassages).toContain(doc.body.slice(137, 278));
        expect(llm.requests).toHaveLength(2);
    });
});

describe('repairing failed checks', () => {
    it('keeps successful stage preparation when retrying a failed document check', async () => {
        const { deps, run, original } = await fixture(true);
        const check = original.documents[0]!.readingCheck!;
        const doc = original.documents[0]!;
        const wire = (q: typeof check.recovery, valid = true) => {
            const { support, ...rest } = q;
            return { ...rest, supportQuotes: valid ? support.map(s => doc.body.slice(s.start, s.end)) : ['Invented source sentence.'] };
        };
        const bank = (valid: boolean) => ({ ...check, variants: check.variants.map(q => wire(q, valid)), recovery: wire(check.recovery, valid) });
        const prep = original.stages[0]!.preparation!;
        const llm = new FakeLlmClient([
            ...Array.from({ length: 4 }, () => ({ json: bank(false) })),
            { json: { ...prep, characters: Object.entries(prep.characters).map(([characterId, groups]) => ({ characterId, groups })) } },
            { json: bank(true) },
        ]);
        deps.llm = () => llm;
        const blocked = await prepareUpgrade(deps, run);
        expect(blocked?.status).toBe('blocked');
        expect((blocked!.candidate as typeof original).stages[0]!.preparation).toEqual(prep);
        const { refineUpgrade } = await import('@/lib/v3/upgrades/service');
        const retry = await refineUpgrade(deps, 'u', 'a', { runId: run.id, proposalRevision: 1, instruction: '' });
        if (!retry.ok) throw Error(retry.message);
        const ready = await prepareUpgrade(deps, retry.run);
        expect(ready?.status).toBe('ready');
        expect(ready?.findings).toEqual([]);
        expect((ready!.candidate as typeof original).stages[0]!.preparation).toEqual(prep);
        expect(llm.requests).toHaveLength(6);
    });
});
