import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, checkSpec, cleanReadingDocument, sourceSentenceSpans, supportsReadingSelection, type AdventureSpec } from '@adventure/spec-v3';
import { MemoryV3PlayStore } from '@/lib/play/v3/store';
import { MemoryUpgradeRepository } from '@/lib/v3/upgrades/repository';
import { startUpgrade, applyUpgrade } from '@/lib/v3/upgrades/service';
import { prepareUpgrade, upgradeProofIssues } from '@/lib/v3/upgrades/migrate';
import { preparationAdventure } from '../fixtures/v3-preparation';

describe('stored reading text upgrade', () => {
  it('cleans existing text without a model, remaps every support and preserves original snapshots', async () => {
    const { spec } = preparationAdventure();
    spec.schemaVersion = '2.1.0';
    spec.characters.forEach(c => c.trustNotice = 'Claims need support.');
    spec.openQuestions = [{ id: 'oq', stageId: spec.stages[0]!.id, text: 'Which concern matters?', discoveryIds: ['disc-1'] }];
    spec.hintAngles = [{ id: 'hint', discoveryId: 'disc-1', kind: 'ask', text: 'Ask about trade.' }];
    spec.endings.forEach(e => { e.epilogue = 'Your simulation: ' + e.epilogue; e.interview.verdicts.forEach(v => v.counterPoints = ['disc-1']); });
    const document = spec.documents[0]!;
    document.body = document.body.replace('complained of', 'complained\r\nof');
    const start = document.body.indexOf('Several'), end = document.body.indexOf(' Their');
    document.keyPassages[0] = { ...document.keyPassages[0]!, start, end };
    for (const question of [...document.readingCheck!.variants, document.readingCheck!.recovery]) question.support = [{ start, end }];
    const store = new MemoryV3PlayStore();
    store.addAdventure({ id: 'game', schoolId: 'school', ownerId: 'teacher', status: 'published', specVersion: 1, publishedVersion: 1, spec });
    const repository = new MemoryUpgradeRepository(store);
    const deps = { store, repository, env: {}, enqueue: async () => {}, llm: () => { throw Error('No model is required'); } };
    const started = await startUpgrade(deps, 'teacher', 'game', { expectedRevision: 1 });
    if (!started.ok) throw Error(started.message);
    const ready = await prepareUpgrade(deps, started.run);
    expect(ready?.status).toBe('ready');
    const candidate = ready!.candidate as AdventureSpec;
    expect(candidate.documents[0]).toEqual(cleanReadingDocument(document));
    expect(candidate.documents[0]!.body).not.toContain('\r\n');
    expect(upgradeProofIssues(spec, ready!)).toEqual([]);
    expect(checkSpec(candidate).errors).toEqual([]);
    for (const question of [...candidate.documents[0]!.readingCheck!.variants, candidate.documents[0]!.readingCheck!.recovery]) {
      const span = question.support[0]!;
      expect(candidate.documents[0]!.body.slice(span.start, span.end)).toBe('Several masters complained of new dues at the anchorage.');
      expect(sourceSentenceSpans(candidate.documents[0]!.body)).toContainEqual(span);
      expect(supportsReadingSelection(candidate.documents[0]!.body, question.support, span.start, span.end)).toBe(true);
      expect(supportsReadingSelection(candidate.documents[0]!.body, question.support, 0, candidate.documents[0]!.body.length)).toBe(false);
    }
    const applied = await applyUpgrade(deps, 'teacher', 'game', { runId: ready!.id, proposalRevision: 1 });
    expect(applied.ok).toBe(true);
    expect(await store.loadVersionSpec('game', 1)).toEqual(spec);
    expect(await store.loadVersionSpec('game', 2)).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, documents: candidate.documents });
    expect((await store.loadAdventure('game'))?.publishedVersion).toBe(1);
    const tampered = structuredClone(ready!);
    (tampered.candidate as AdventureSpec).documents[0]!.body += ' Invented claim.';
    (tampered.migrationState as { completed: { candidate: AdventureSpec }[] }).completed[0]!.candidate = tampered.candidate as AdventureSpec;
    expect(upgradeProofIssues(spec, tampered).length).toBeGreaterThan(0);
  });
});
