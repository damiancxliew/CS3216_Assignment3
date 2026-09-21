"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Admits the signed-in student to the adventure behind the link. Everything
 * that decides whether that is allowed — published or not, new attempt or
 * resume, which version to pin, when the stage deadline falls — happens inside
 * `join_adventure`, so a forged token or an unpublished adventure fails in the
 * database rather than in this handler.
 */
export async function joinAdventure(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_adventure", {
    p_token: token,
  });

  if (error || !data) {
    redirect(`/join/${token}?error=join`);
  }

  redirect(`/play/${data}`);
}
