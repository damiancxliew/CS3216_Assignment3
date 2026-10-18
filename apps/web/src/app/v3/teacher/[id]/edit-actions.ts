'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseV3PlayStore } from '@/lib/play/v3/store';
import { supabaseV3SourceStore } from '@/lib/v3/generation/deps';
import { saveAdventureEdits, type SaveV3Result } from '@/lib/v3/edit/service';
import type { V3Edit } from '@/lib/v3/edit/commands';
import { v3Enabled } from '@/lib/v3/flag';

export async function saveV3AdventureEdits(adventureId: string, expectedVersion: number, edits: V3Edit[]): Promise<SaveV3Result> {
  if (!v3Enabled()) return { ok: false, code: 'access', message: 'Not found.' };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false, code: 'access', message: 'Sign in again to save. Your local work is still here.' };
  const admin = createAdminClient();
  const result = await saveAdventureEdits({
    store: new SupabaseV3PlayStore(admin),
    sources: async id => (await supabaseV3SourceStore(() => admin).load(id)).map(d => ({ id: d.id, title: d.title, text: d.pages.map(p => p.text).join('\n') })),
  }, user.id, adventureId, expectedVersion, edits);
  if (result.ok) revalidatePath(`/v3/teacher/${adventureId}`, 'layout');
  return result;
}
