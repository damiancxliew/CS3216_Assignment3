"use server";

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { compareSchemaVersions } from '@adventure/spec-v3';
import { createClient } from '@/lib/supabase/server';

import { defaultUpgradeDeps } from '@/lib/v3/upgrades/deps';
import { startUpgrade, getUpgrade, refineUpgrade, applyUpgrade, discardUpgrade } from '@/lib/v3/upgrades/service';
import type { UpgradeResult, UpgradeStartInput, UpgradeProposalInput, UpgradeRefineInput } from '@/lib/v3/upgrades/types';
import { tickUrl } from '@/lib/jobs/tick';
import { headers } from 'next/headers';

const proposalInput = z.strictObject({ runId: z.string().uuid(), proposalRevision: z.number().int().positive() });
const targetVersion = z.string().refine((value) => {
  try { compareSchemaVersions(value, value); return true; }
  catch { return false; }
});
const startInput = z.strictObject({ expectedRevision: z.number().int().nonnegative(), targetSchemaVersion: targetVersion.optional() });
const refineInput = proposalInput.extend({ instruction: z.string().trim().max(4000) });
const denied = (): UpgradeResult => ({ ok: false, code: 'access', message: 'Not found.' });
const invalid = (): UpgradeResult => ({ ok: false, code: 'invalid', message: 'Check the upgrade request and try again.' });

async function actor(adventureId: string) {
  if (!z.string().uuid().safeParse(adventureId).success) return null;
  const { data: { user } } = await (await createClient()).auth.getUser();
  return user;
}

async function schedule(result: UpgradeResult) {
  if (result.ok && result.run.status === 'running') {
    const requestHeaders = await headers();
    const host = requestHeaders.get('host');
    const protocol = requestHeaders.get('x-forwarded-proto') ?? 'https';
    const url = process.env.JOBS_TICK_URL ?? (host ? tickUrl(`${protocol}://${host}`) : null);
    if (url) after(async () => {
      const { kickTick } = await import('@/lib/jobs/runner');
      await kickTick(url);
    });
  }
  return result;
}

export async function startUpgradeAction(adventureId: string, input: UpgradeStartInput): Promise<UpgradeResult> {
  const user = await actor(adventureId);
  if (!user) return denied();
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return invalid();
  return schedule(await startUpgrade(defaultUpgradeDeps(), user.id, adventureId, parsed.data));
}

export async function getUpgradeAction(adventureId: string, runId?: string): Promise<UpgradeResult | null> {
  const user = await actor(adventureId);
  if (!user) return denied();
  if (runId !== undefined && !z.string().uuid().safeParse(runId).success) return invalid();
  return getUpgrade(defaultUpgradeDeps(), user.id, adventureId, runId);
}

export async function refineUpgradeAction(adventureId: string, input: UpgradeRefineInput): Promise<UpgradeResult> {
  const user = await actor(adventureId);
  if (!user) return denied();
  const parsed = refineInput.safeParse(input);
  if (!parsed.success) return invalid();
  return schedule(await refineUpgrade(defaultUpgradeDeps(), user.id, adventureId, parsed.data));
}

export async function applyUpgradeAction(adventureId: string, input: UpgradeProposalInput): Promise<UpgradeResult> {
  const user = await actor(adventureId);
  if (!user) return denied();
  const parsed = proposalInput.safeParse(input);
  if (!parsed.success) return invalid();
  const result = await applyUpgrade(defaultUpgradeDeps(), user.id, adventureId, parsed.data);
  if (result.ok) revalidatePath(`/v3/teacher/${adventureId}`, 'layout');
  return result;
}

export async function discardUpgradeAction(adventureId: string, input: UpgradeProposalInput): Promise<UpgradeResult> {
  const user = await actor(adventureId);
  if (!user) return denied();
  const parsed = proposalInput.safeParse(input);
  if (!parsed.success) return invalid();
  return discardUpgrade(defaultUpgradeDeps(), user.id, adventureId, parsed.data);
}
