import type { SupabaseClient } from "@supabase/supabase-js";

/** A stage is only writable through the adventure that owns its spec version. */
export async function stageBelongsTo(admin: SupabaseClient, adventureId: string, stageId: string): Promise<boolean> {
  const { data } = await admin
    .from("stage")
    .select("id, spec_version!inner(adventure_id)")
    .eq("id", stageId)
    .eq("spec_version.adventure_id", adventureId)
    .maybeSingle();
  return data !== null;
}

/** An agent is only writable through the adventure that owns its stage's spec version. */
export async function agentBelongsTo(admin: SupabaseClient, adventureId: string, agentId: string): Promise<boolean> {
  const { data } = await admin
    .from("agent")
    .select("stage_id")
    .eq("id", agentId)
    .maybeSingle();
  if (!data) return false;
  return stageBelongsTo(admin, adventureId, data.stage_id);
}
