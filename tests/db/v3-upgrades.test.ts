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
            source_schema_version: 1,
            target_schema_version: 2,
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
});
