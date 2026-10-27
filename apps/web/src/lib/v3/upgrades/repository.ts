import type { SupabaseClient } from '@supabase/supabase-js';
import type { V3PlayStore } from '@/lib/play/v3/store';
import type { RunPatch, UpgradeRun } from './types';
export interface UpgradeRepository {
    create(run: UpgradeRun): Promise<{
        run: UpgradeRun;
        created: boolean;
    }>;
    get(id: string): Promise<UpgradeRun | null>;
    latest(adventureId: string): Promise<UpgradeRun | null>;
    update(id: string, expectedProposal: number, patch: RunPatch, expectedCompleted?: number): Promise<UpgradeRun | null>;
    apply(id: string, expectedProposal: number): Promise<UpgradeRun | null>;
}
export class MemoryUpgradeRepository implements UpgradeRepository {
    private rows = new Map<string, UpgradeRun>();
    private applying = new Set<string>();
    constructor(private store: V3PlayStore) {
    }
    async create(run: UpgradeRun) {
        const prior = [...this.rows.values()].find(r => r.adventureId === run.adventureId && r.sourceRevision === run.sourceRevision && r.targetSchemaVersion === run.targetSchemaVersion && !['discarded', 'stale'].includes(r.status));
        if (prior)
            return {
                run: structuredClone(prior),
                created: false
            };
        this.rows.set(run.id, structuredClone(run));
        return {
            run: structuredClone(run),
            created: true
        };
    }
    async get(id: string) {
        return structuredClone(this.rows.get(id) ?? null);
    }
    async latest(id: string) {
        return structuredClone([...this.rows.values()].filter(r => r.adventureId === id).at(-1) ?? null);
    }
    async update(id: string, rev: number, patch: RunPatch, expectedCompleted?: number) {
        const r = this.rows.get(id);
        if (this.applying.has(id) || !r || r.proposalRevision !== rev || expectedCompleted !== undefined && r.progress.completed !== expectedCompleted || ['applied', 'discarded', 'stale'].includes(r.status))
            return null;
        Object.assign(r, structuredClone(patch));
        return structuredClone(r);
    }
    async apply(id: string, rev: number) {
        const r = this.rows.get(id);
        if (!r || r.proposalRevision !== rev)
            return null;
        if (r.status === 'applied')
            return structuredClone(r);
        if (r.status !== 'ready' || !r.candidate)
            return null;
        // Reserve synchronously, matching the database row lock, before awaiting the draft write.
        this.applying.add(id);
        r.status = 'running';
        let saved: {
            saved: boolean;
            version?: number;
        };
        try {
            saved = await this.store.saveDraft(r.adventureId, r.sourceRevision, r.candidate);
        }
        catch (error) {
            r.status = 'ready';
            throw error;
        }
        finally {
            this.applying.delete(id);
        }
        if (!saved.saved) {
            r.status = 'stale';
            return null;
        }
        r.status = 'applied';
        r.appliedRevision = saved.version!;
        return structuredClone(r);
    }
}
function fromRow(row: Record<string, unknown>): UpgradeRun {
    return {
        id: String(row.id),
        adventureId: String(row.adventure_id),
        requesterId: String(row.requester_id),
        schoolId: String(row.school_id),
        sourceRevision: Number(row.source_revision),
        sourceSchemaVersion: Number(row.source_schema_version),
        targetSchemaVersion: Number(row.target_schema_version),
        proposalRevision: Number(row.proposal_revision),
        status: row.status as UpgradeRun['status'],
        candidate: row.candidate ?? null,
        migrationState: row.migration_state ?? {},
        findings: (row.findings ?? []) as UpgradeRun['findings'],
        summary: row.summary as UpgradeRun['summary'],
        progress: row.progress as UpgradeRun['progress'],
        appliedRevision: row.applied_revision === null ? null : Number(row.applied_revision),
        error: row.error as string | null,
        instruction: String(row.instruction ?? ''),
        createdAt: String(row.created_at)
    };
}
function toRow(run: UpgradeRun) {
    return {
        id: run.id,
        adventure_id: run.adventureId,
        requester_id: run.requesterId,
        school_id: run.schoolId,
        source_revision: run.sourceRevision,
        source_schema_version: run.sourceSchemaVersion,
        target_schema_version: run.targetSchemaVersion,
        proposal_revision: run.proposalRevision,
        status: run.status,
        candidate: run.candidate,
        migration_state: run.migrationState ?? {},
        findings: run.findings,
        summary: run.summary,
        progress: run.progress,
        applied_revision: run.appliedRevision,
        error: run.error,
        instruction: run.instruction
    };
}
export class SupabaseUpgradeRepository implements UpgradeRepository {
    constructor(private admin: SupabaseClient) {
    }
    async create(run: UpgradeRun) {
        const { data, error } = await this.admin.rpc('start_upgrade_v3', {
            p_run: toRow(run)
        });
        if (error)
            throw error;
        return {
            run: fromRow(data.run),
            created: data.created === true
        };
    }
    async get(id: string) {
        const { data, error } = await this.admin.from('upgrade_runs_v3').select('*').eq('id', id).maybeSingle();
        if (error)
            throw error;
        return data ? fromRow(data) : null;
    }
    async latest(id: string) {
        const { data, error } = await this.admin.from('upgrade_runs_v3').select('*').eq('adventure_id', id).order('created_at', {
            ascending: false
        }).limit(1).maybeSingle();
        if (error)
            throw error;
        return data ? fromRow(data) : null;
    }
    async update(id: string, rev: number, patch: RunPatch, expectedCompleted?: number) {
        const { proposalRevision, migrationState, ...rest } = patch;
        let query = this.admin.from('upgrade_runs_v3').update({
            ...rest,
            ...(migrationState === undefined ? {} : {
                migration_state: migrationState
            }),
            ...(proposalRevision === undefined ? {} : {
                proposal_revision: proposalRevision
            })
        }).eq('id', id).eq('proposal_revision', rev).not('status', 'in', '(applied,discarded,stale)');
        if (expectedCompleted !== undefined)
            query = query.eq('progress->>completed', String(expectedCompleted));
        const { data, error } = await query.select('*').maybeSingle();
        if (error)
            throw error;
        return data ? fromRow(data) : null;
    }
    async apply(id: string, rev: number) {
        const { data, error } = await this.admin.rpc('apply_upgrade_v3', {
            p_run_id: id,
            p_proposal_revision: rev
        });
        if (error)
            throw error;
        return data ? fromRow(data) : null;
    }
}
