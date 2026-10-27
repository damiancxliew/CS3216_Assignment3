import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Call only after verifying that the requested published link permits public play. */
export async function createGuestSession(supabase: SupabaseClient): Promise<User | null> {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) return null;
  // The split Auth/Data deployment mirrors identities before inserting attempts.
  if (process.env.NEXT_PUBLIC_DATA_URL) {
    const { error: syncError } = await supabase.rpc("sync_auth_user");
    if (syncError) {
      await supabase.auth.signOut();
      return null;
    }
  }
  return data.user;
}
