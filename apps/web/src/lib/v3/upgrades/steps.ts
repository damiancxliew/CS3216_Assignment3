import { defineStep, type Json, type StepDefinition } from '@adventure/jobs';
import { canStaffAdventure } from '@/lib/play/v3/access';
import { prepareUpgrade, type MigrationDeps } from './migrate';
import { defaultUpgradeDeps } from './deps';
export function upgradeSteps(getDeps: () => MigrationDeps = defaultUpgradeDeps): StepDefinition[] {
    return [defineStep('v3.upgrade.prepare', async (ctx) => {
            const deps = getDeps();
            const input = ctx.input as {
                runId: string;
                proposalRevision: number;
                completed: number;
                stepId: string | null;
            };
            const run = await deps.repository.get(input.runId);
            if (!run || run.status !== 'running' || run.proposalRevision !== input.proposalRevision)
                return {
                    skipped: true
                };
            if (run.progress.completed !== input.completed || (run.progress.stepId ?? null) !== input.stepId) {
                await deps.enqueue(run);
                return {
                    skipped: true
                };
            }
            const a = await deps.store.loadAdventure(run.adventureId);
            if (!a || !await canStaffAdventure(deps.store, a, run.requesterId, deps.env)) {
                await deps.repository.update(run.id, run.proposalRevision, {
                    status: 'failed',
                    error: 'Access to this adventure is no longer available.'
                });
                return {
                    skipped: true
                };
            }
            if (a.specVersion !== run.sourceRevision) {
                await deps.repository.update(run.id, run.proposalRevision, {
                    status: 'stale',
                    error: 'The adventure changed. Start a new upgrade.'
                });
                return {
                    skipped: true
                };
            }
            try {
                const updated = await prepareUpgrade(deps, run, true);
                if (updated?.status === 'running')
                    await deps.enqueue(updated);
                return {
                    status: updated?.status ?? 'superseded'
                } as Json;
            }
            catch (error) {
                const current = await deps.repository.get(run.id);
                if (current?.status === 'running' && current.proposalRevision === input.proposalRevision) {
                    if (current.progress.completed !== input.completed || (current.progress.stepId ?? null) !== input.stepId)
                        await deps.enqueue(current);
                    else if (ctx.attempt >= 3)
                        await deps.repository.update(run.id, input.proposalRevision, {
                            status: 'failed',
                            error: 'The upgrade could not finish. Retry to continue from saved progress.'
                        }, input.completed);
                }
                throw error;
            }
        })];
}
