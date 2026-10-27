import { beforeAll, describe, it, expect } from 'vitest';
import { createOrganization, createUserClient, addMember, serviceClient, uniqueEmail } from './helpers';
const admin = serviceClient();
let school: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
beforeAll(async () => {
    school = await createOrganization('Schema upgrades');
    owner = await createUserClient(uniqueEmail('upgrades'));
    await addMember(school, owner.userId, 'teacher');
});
async function fixture() {
    const { data: a, error } = await admin.from('adventures_v3').insert({
        school_id: school,
        owner_id: owner.userId,
        status: 'draft',
        spec: {
            title: 'Original'
        }
    }).select('*').single();
    if (error)
        throw error;
    const id = crypto.randomUUID();
    const started = await admin.rpc('start_upgrade_v3', {
        p_run: {
            id,
            adventure_id: a.id,
            requester_id: owner.userId,
            source_revision: 1,
            source_schema_version: '1.0.0',
            target_schema_version: '2.0.0',
            summary: {
                documents: 0,
                stages: 0,
                changes: []
            },
            progress: {
                completed: 0,
                total: 1,
                label: 'Preparing'
            }
        }
    });
    if (started.error)
        throw started.error;
    return {
        a,
        run: started.data.run
    };
}
describe('schema upgrade persistence', () => {
    it('deduplicates concurrent starts, keeps authenticated access read-only', async () => {
        const { a, run } = await fixture();
        const starts = await Promise.all([0, 1].map(() => admin.rpc('start_upgrade_v3', {
            p_run: {
                ...run,
                id: crypto.randomUUID()
            }
        })));
        expect(starts.every(r => !r.error && r.data.run.id === run.id && r.data.created === false)).toBe(true);
        const visible = await owner.client.from('upgrade_runs_v3').select('*').eq('id', run.id);
        expect(visible.error).toBeNull();
        expect(visible.data).toHaveLength(1);
        const denied = await owner.client.from('upgrade_runs_v3').update({
            candidate: {
                schemaVersion: 2
            }
        }).eq('id', run.id);
        expect(denied.error).not.toBeNull();
        const rpc = await owner.client.rpc('apply_upgrade_v3', {
            p_run_id: run.id,
            p_proposal_revision: 1
        });
        expect(rpc.error).not.toBeNull();
        expect((await admin.from('adventures_v3').select('spec_version').eq('id', a.id).single()).data?.spec_version).toBe(1);
    });
    it('atomically applies exactly once while retaining old publication snapshot', async () => {
        const { a, run } = await fixture();
        await admin.rpc('publish_adventure_v3', {
            p_id: a.id,
            p_expected_version: 1,
            p_expected_published: null,
            p_publish: true
        });
        await admin.from('upgrade_runs_v3').update({
            status: 'ready',
            candidate: {
                title: 'Original',
                schemaVersion: 2
            }
        }).eq('id', run.id);
        const results = await Promise.all([0, 1].map(() => admin.rpc('apply_upgrade_v3', {
            p_run_id: run.id,
            p_proposal_revision: 1
        })));
        expect(results.every(r => !r.error && r.data?.applied_revision === 2)).toBe(true);
        const row = (await admin.from('adventures_v3').select('*').eq('id', a.id).single()).data;
        expect(row).toMatchObject({
            spec_version: 2,
            published_version: 1,
            status: 'published'
        });
        const versions = await admin.from('adventure_versions_v3').select('version').eq('adventure_id', a.id);
        expect(versions.data).toHaveLength(2);
        const original = await admin.from('adventure_versions_v3').select('spec').eq('adventure_id', a.id).eq('version', 1).single();
        expect(original.data?.spec).toEqual({
            title: 'Original'
        });
    });
    it('refuses stale proposals without saving a candidate', async () => {
        const { a, run } = await fixture();
        await admin.from('upgrade_runs_v3').update({
            status: 'ready',
            candidate: {
                title: 'Original',
                schemaVersion: 2
            }
        }).eq('id', run.id);
        await admin.rpc('save_adventure_v3', {
            p_id: a.id,
            p_expected_version: 1,
            p_spec: {
                title: 'Edited'
            }
        });
        const applied = await admin.rpc('apply_upgrade_v3', {
            p_run_id: run.id,
            p_proposal_revision: 1
        });
        expect(applied.error).toBeNull();
        expect(applied.data).toBeNull();
        const row = (await admin.from('adventures_v3').select('spec,spec_version').eq('id', a.id).single()).data;
        expect(row).toMatchObject({
            spec_version: 2,
            spec: {
                title: 'Edited'
            }
        });
        expect((await admin.from('upgrade_runs_v3').select('status').eq('id', run.id).single()).data?.status).toBe('stale');
    });
    it('denies a teacher from another school access to source proposals', async () => {
        const { run } = await fixture();
        const outsider = await createUserClient(uniqueEmail('outsider'));
        const read = await outsider.client.from('upgrade_runs_v3').select('*').eq('id', run.id);
        expect(read.error).toBeNull();
        expect(read.data).toEqual([]);
    });
    it('orders semantic versions numerically and rejects malformed versions and downgrades', async () => {
        const { run } = await fixture();
        const advanced = await admin.from('upgrade_runs_v3').update({
            source_schema_version: '2.9.0',
            target_schema_version: '2.10.0'
        }).eq('id', run.id).select('source_schema_version,target_schema_version').single();
        expect(advanced.error).toBeNull();
        expect(advanced.data).toEqual({
            source_schema_version: '2.9.0',
            target_schema_version: '2.10.0'
        });
        for (const target of ['2.8.0', '2.9.0', '02.10.0', '2.10.0-beta']) {
            const refused = await admin.from('upgrade_runs_v3').update({
                target_schema_version: target
            }).eq('id', run.id);
            expect(['23514', '22P02']).toContain(refused.error?.code);
        }
    });
    it('keeps pinned historical and latest upgrade intents distinct for the same source revision', async () => {
        const { run } = await fixture();
        const latest = await admin.rpc('start_upgrade_v3', {
            p_run: {
                ...run,
                id: crypto.randomUUID(),
                target_schema_version: '2.1.0'
            }
        });
        expect(latest.error).toBeNull();
        expect(latest.data.created).toBe(true);
        expect(latest.data.run.id).not.toBe(run.id);
        const historical = await admin.rpc('start_upgrade_v3', {
            p_run: {
                ...run,
                id: crypto.randomUUID()
            }
        });
        expect(historical.error).toBeNull();
        expect(historical.data).toMatchObject({
            created: false,
            run: {
                id: run.id,
                target_schema_version: '2.0.0'
            }
        });
    });
});
