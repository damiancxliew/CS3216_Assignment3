"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * "Play it again" at the ending. Everything that decides whether a second
 * attempt is allowed — whose attempt this is, whether the teacher left retries
 * on, which version the new attempt pins, when its deadline falls — happens
 * inside `restart_attempt`, so a hand-rolled request fails in the database
 * rather than here.
 */
export async function restartAttempt(
  attemptId: string,
): Promise<{ ok: true; attemptId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restart_attempt", {
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    return { ok: false, error: "Could not start a new attempt. Your teacher may have switched retries off." };
  }
  return { ok: true, attemptId: data as string };
}
