import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '@adventure/spec-v3';
const f = vi.hoisted(() => ({ user: 'teacher' as string | null, enabled: true, start: vi.fn(), get: vi.fn(), refine: vi.fn(), apply: vi.fn(), discard: vi.fn(), deps: vi.fn(), after: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: f.user ? { id: f.user } : null } }) } }) }));
vi.mock('@/lib/v3/flag', () => ({ v3Enabled: () => f.enabled }));
vi.mock('@/lib/v3/upgrades/deps', () => ({ defaultUpgradeDeps: f.deps }));
vi.mock('@/lib/v3/upgrades/service', () => ({ startUpgrade: f.start, getUpgrade: f.get, refineUpgrade: f.refine, applyUpgrade: f.apply, discardUpgrade: f.discard }));
vi.mock('next/server', () => ({ after: f.after }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000', 'x-forwarded-proto': 'http' }) }));
vi.mock('next/cache', () => ({ revalidatePath: f.revalidate }));
import { startUpgradeAction, getUpgradeAction, refineUpgradeAction, applyUpgradeAction, discardUpgradeAction } from '@/app/v3/teacher/[id]/upgrade-actions';
const id = '00000000-0000-4000-8000-000000000346';
const proposal = { runId: '00000000-0000-4000-8000-000000000347', proposalRevision: 1 };
beforeEach(() => {
  vi.clearAllMocks(); f.user = 'teacher'; f.enabled = true;
  f.deps.mockReturnValue({});
  f.start.mockResolvedValue({ ok: true, run: { status: 'running' } });
  f.get.mockResolvedValue(null);
  f.apply.mockResolvedValue({ ok: true, run: { status: 'applied', appliedRevision: 2 } });
});
describe('teacher upgrade action boundary', () => {
  it('accepts and forwards a canonical schema version string', async () => {
    expect(await startUpgradeAction(id, { expectedRevision: 1, targetSchemaVersion: CURRENT_SCHEMA_VERSION })).toMatchObject({ ok: true });
    expect(f.start).toHaveBeenCalledWith({}, 'teacher', id, { expectedRevision: 1, targetSchemaVersion: CURRENT_SCHEMA_VERSION });
  });
  it.each([2, '2.1', 'v2.1.0', '02.1.0', '2.1.0-beta', '2.1.0+build', '9007199254740992.0.0'])(
    'rejects noncanonical target versions before creating a run: %s', async (targetSchemaVersion) => {
      expect(await startUpgradeAction(id, { expectedRevision: 1, targetSchemaVersion } as never)).toMatchObject({ ok: false, code: 'invalid' });
      expect(f.deps).not.toHaveBeenCalled();
      expect(f.start).not.toHaveBeenCalled();
    },
  );
  it('denies unauthenticated, disabled and malformed requests before accessing proposal storage', async () => {
    f.user = null;
    expect(await startUpgradeAction(id, { expectedRevision: 1 })).toMatchObject({ ok: false, code: 'access' });
    f.user = 'teacher'; f.enabled = false;
    expect(await getUpgradeAction(id)).toMatchObject({ ok: false, code: 'access' });
    f.enabled = true;
    expect(await getUpgradeAction(id, 'bad')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await startUpgradeAction(id, { expectedRevision: -1 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await applyUpgradeAction(id, { ...proposal, proposalRevision: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await refineUpgradeAction(id, { ...proposal, instruction: 'x'.repeat(4001) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await discardUpgradeAction('bad', proposal)).toMatchObject({ ok: false, code: 'access' });
    expect(f.deps).not.toHaveBeenCalled();
  });
  it('queues generation after a successful start without applying the proposal', async () => {
    await startUpgradeAction(id, { expectedRevision: 1 });
    expect(f.start).toHaveBeenCalledWith({}, 'teacher', id, { expectedRevision: 1 });
    expect(f.after).toHaveBeenCalledOnce();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.revalidate).not.toHaveBeenCalled();
  });
  it('only refreshes the saved draft after an explicit successful Apply', async () => {
    await applyUpgradeAction(id, proposal);
    expect(f.apply).toHaveBeenCalledWith({}, 'teacher', id, proposal);
    expect(f.revalidate).toHaveBeenCalledWith(`/v3/teacher/${id}`, 'layout');
    expect(f.start).not.toHaveBeenCalled();
    expect(f.after).not.toHaveBeenCalled();
  });
});
