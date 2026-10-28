import { CURRENT_SCHEMA_VERSION, decodeStoredSpec, getSchemaVersion, getUpgradePath, validateSpec, checkSpec } from '@adventure/spec-v3';
import { canStaffAdventure } from '@/lib/play/v3/access';
import type { V3PlayStore } from '@/lib/play/v3/store';
import { isDeepStrictEqual } from 'node:util';
import { upgradeProofIssues } from './migrate';
import type { UpgradeCheckpoint } from './runner';
import type { UpgradeDescriptor } from '@adventure/spec-v3';
import type { AdventureSpec } from '@adventure/spec-v3';
import type { UpgradeRepository } from './repository';
import type { UpgradeRun, UpgradeResult, UpgradeStartInput, UpgradeProposalInput, UpgradeRefineInput } from './types';
export interface UpgradeDeps {
    store: V3PlayStore;
    repository: UpgradeRepository;
    env?: NodeJS.ProcessEnv;
    enqueue(run: UpgradeRun): Promise<void>;
}
const fail = (code: 'access' | 'conflict' | 'invalid' | 'unsupported', message: string): UpgradeResult => ({
    ok: false,
    code,
    message
});
async function authorized(deps: UpgradeDeps, user: string, id: string) {
    const a = await deps.store.loadAdventure(id);
    return a && await canStaffAdventure(deps.store, a, user) && ['draft', 'published', 'archived'].includes(a.status) ? a : null;
}
export async function startUpgrade(deps: UpgradeDeps, user: string, id: string, input: UpgradeStartInput): Promise<UpgradeResult> {
    const a = await authorized(deps, user, id);
    if (!a)
        return fail('access', 'Not found.');
    if (!Number.isInteger(input.expectedRevision) || a.specVersion !== input.expectedRevision)
        return fail('conflict', 'Save your edits and reload before upgrading.');
    const source = await deps.store.loadVersionSpec(id, a.specVersion);
    const decoded = decodeStoredSpec(source);
    if (!decoded.ok)
        return fail('invalid', 'The saved adventure cannot be read. Resolve its structural issues first.');
    const from = getSchemaVersion(source);
    const target = input.targetSchemaVersion ?? CURRENT_SCHEMA_VERSION;
    if (!from || target !== CURRENT_SCHEMA_VERSION)
        return fail('unsupported', 'This schema upgrade is not supported.');
    if (from === target)
        return fail('unsupported', 'This adventure already uses the latest format.');
    try {
        getUpgradePath(from, target);
    }
    catch {
        return fail('unsupported', 'No upgrade path is available for this format.');
    }
    const run: UpgradeRun = {
        id: crypto.randomUUID(),
        adventureId: id,
        requesterId: user,
        schoolId: a.schoolId,
        sourceRevision: a.specVersion,
        sourceSchemaVersion: from,
        targetSchemaVersion: target,
        proposalRevision: 1,
        status: 'running',
        candidate: null,
        findings: [],
        summary: {
            documents: 0,
            stages: 0,
            changes: []
        },
        progress: {
            completed: 0,
            total: 1,
            label: 'Preparing upgrade'
        },
        appliedRevision: null,
        error: null,
        instruction: '',
        createdAt: new Date().toISOString()
    };
    const created = await deps.repository.create(run);
    if (created.created) {
        try {
            await deps.enqueue(created.run);
        }
        catch {
            const failed = await deps.repository.update(created.run.id, 1, {
                status: 'failed',
                error: 'The upgrade could not be queued. Retry to continue.'
            });
            return {
                ok: true,
                run: failed ?? created.run
            };
        }
    }
    return {
        ok: true,
        run: created.run
    };
}
export async function getUpgrade(deps: UpgradeDeps, user: string, id: string, runId?: string): Promise<UpgradeResult | null> {
    const a = await authorized(deps, user, id);
    if (!a)
        return fail('access', 'Not found.');
    let run = runId ? await deps.repository.get(runId) : await deps.repository.latest(id);
    if (!run)
        return runId ? fail('access', 'Not found.') : null;
    if (run.adventureId !== id)
        return fail('access', 'Not found.');
    if (!['applied', 'discarded', 'stale'].includes(run.status) && run.sourceRevision !== a.specVersion)
        run = await deps.repository.update(run.id, run.proposalRevision, {
            status: 'stale',
            error: 'The saved adventure changed. Start a new upgrade.'
        }) ?? run;
    return {
        ok: true,
        run
    };
}
async function proposal(deps: UpgradeDeps, user: string, id: string, input: UpgradeProposalInput) {
    const r = await getUpgrade(deps, user, id, input.runId);
    return r?.ok && r.run.proposalRevision !== input.proposalRevision ? fail('conflict', 'The proposal changed. Reload its latest revision.') : r ?? fail('access', 'Not found.');
}
export async function refineUpgrade(deps: UpgradeDeps, user: string, id: string, input: UpgradeRefineInput): Promise<UpgradeResult> {
    const r = await proposal(deps, user, id, input);
    if (!r.ok)
        return r;
    if (!['ready', 'blocked', 'failed'].includes(r.run.status))
        return fail('conflict', 'This upgrade cannot be changed now.');
    if (typeof input.instruction !== 'string' || input.instruction.length > 4000)
        return fail('invalid', 'Keep the request within 4,000 characters.');
    const state = reopenUpgradeCheckpoint(r.run.migrationState as UpgradeCheckpoint<AdventureSpec> | undefined, getUpgradePath(r.run.sourceSchemaVersion, r.run.targetSchemaVersion), input.instruction.trim().length > 0);
    const next = await deps.repository.update(r.run.id, input.proposalRevision, {
        migrationState: state ?? {},
        proposalRevision: input.proposalRevision + 1,
        status: 'running',
        instruction: input.instruction.trim(),
        error: null,
        findings: [],
        progress: {
            completed: 0,
            total: r.run.progress.total,
            label: 'Preparing revised proposal',
            stepId: state?.active?.stepId
        }
    });
    if (!next)
        return fail('conflict', 'The proposal changed. Reload.');
    try {
        await deps.enqueue(next);
    }
    catch {
        const failed = await deps.repository.update(next.id, next.proposalRevision, {
            status: 'failed',
            error: 'The upgrade could not be queued. Retry to continue.'
        });
        return {
            ok: true,
            run: failed ?? next
        };
    }
    return {
        ok: true,
        run: next
    };
}
export async function applyUpgrade(deps: UpgradeDeps, user: string, id: string, input: UpgradeProposalInput): Promise<UpgradeResult> {
    const r = await proposal(deps, user, id, input);
    if (!r.ok)
        return r;
    if (r.run.status === 'applied')
        return r;
    if (r.run.status !== 'ready' || r.run.findings.length || !r.run.candidate)
        return fail('invalid', 'Resolve the upgrade findings before applying.');
    const checked = validateSpec(r.run.candidate);
    if (!checked.ok || getSchemaVersion(r.run.candidate) !== r.run.targetSchemaVersion || checkSpec(checked.spec).errors.length)
        return fail('invalid', 'The candidate does not match its target format or gameplay requirements.');
    const source = decodeStoredSpec(await deps.store.loadVersionSpec(id, r.run.sourceRevision));
    if (!source.ok || upgradeProofIssues(source.spec, r.run).length || !isDeepStrictEqual((r.run.migrationState as UpgradeCheckpoint<AdventureSpec> | undefined)?.completed.at(-1)?.candidate, checked.spec))
        return fail('invalid', 'The upgrade must preserve existing source, story and media selections.');
    const applied = await deps.repository.apply(r.run.id, input.proposalRevision);
    return applied ? {
        ok: true,
        run: applied
    } : fail('conflict', 'The adventure or proposal changed. Reload before applying.');
}
export async function discardUpgrade(deps: UpgradeDeps, user: string, id: string, input: UpgradeProposalInput): Promise<UpgradeResult> {
    const r = await proposal(deps, user, id, input);
    if (!r.ok)
        return r;
    if (r.run.status === 'discarded')
        return r;
    if (['applied', 'stale'].includes(r.run.status))
        return fail('conflict', 'This upgrade cannot be discarded now.');
    const next = await deps.repository.update(r.run.id, input.proposalRevision, {
        status: 'discarded'
    });
    return next ? {
        ok: true,
        run: next
    } : fail('conflict', 'The proposal changed. Reload.');
}
/** Content refinements invalidate dependent steps; retries keep completed predecessors. */
export function reopenUpgradeCheckpoint<T extends {
    schemaVersion?: number | string;
}>(checkpoint: UpgradeCheckpoint<T> | undefined, path: readonly UpgradeDescriptor[], refine: boolean): UpgradeCheckpoint<T> | undefined {
    if (!checkpoint?.completed)
        return undefined;
    const state = structuredClone(checkpoint);
    if (refine) {
        const firstContent = path.findIndex(step => step.kind === 'content');
        const index = firstContent < 0 ? 0 : firstContent;
        const recorded = state.completed[index] ?? state.active;
        if (recorded) {
            state.completed = state.completed.slice(0, index);
            state.active = {
                ...recorded,
                candidate: {
                    ...recorded.candidate,
                    schemaVersion: path[index]!.from
                }
            };
        }
    }
    else if (!state.active && state.completed.length) {
        const recorded = state.completed.pop()!;
        state.active = {
            ...recorded,
            candidate: {
                ...recorded.candidate,
                schemaVersion: recorded.source.schemaVersion ?? '1.0.0'
            }
        };
    }
    return state;
}
