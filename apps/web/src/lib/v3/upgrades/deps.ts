import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseV3PlayStore } from '@/lib/play/v3/store';
import type { UpgradeRun } from './types';
import type { NewJobStep } from '@adventure/jobs';
import { supabaseJobStore } from '@adventure/jobs';
import { OpenAiLlmClient } from '@adventure/generation/llm';
import { withJsonUsage } from '@/lib/usage/ledger';
import { SupabaseUpgradeRepository } from './repository';
import type { MigrationDeps } from './migrate';
export function defaultUpgradeDeps(): MigrationDeps {
    const admin = createAdminClient();
    return {
        store: new SupabaseV3PlayStore(admin),
        repository: new SupabaseUpgradeRepository(admin),
        async enqueue(run) {
            const jobs = supabaseJobStore(admin);
            const step = upgradeJobStep(run);
            const name = step.name;
            if ((await jobs.list(run.id)).some(row => row.name === name))
                return;
            try {
                await jobs.enqueue(run.id, [step]);
            }
            catch (error) {
                // A lease retry may race a continuation enqueued before its predecessor
                // completed. The same deterministic checkpoint is already queued.
                if (!(await jobs.list(run.id)).some(step => step.name === name))
                    throw error;
            }
        },
        llm(run) {
            return withJsonUsage(new OpenAiLlmClient({
                timeoutMs: 50000,
                maxRetries: 0
            }), {
                purpose: 'generation',
                userId: run.requesterId,
                organizationId: run.schoolId,
                adventureV3Id: run.adventureId,
            });
        },
    };
}
export function upgradeJobStep(run: UpgradeRun): NewJobStep {
    return {
        name: `proposal-${run.proposalRevision}-${run.progress.stepId ?? 'start'}-part-${run.progress.completed}`,
        step: 'v3.upgrade.prepare',
        input: {
            runId: run.id,
            proposalRevision: run.proposalRevision,
            completed: run.progress.completed,
            stepId: run.progress.stepId ?? null
        },
        deps: [],
        maxAttempts: 3
    };
}
