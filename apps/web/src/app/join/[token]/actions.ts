"use server";

import { createGuestSession } from "@/lib/auth/guest";
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const { data: isPublic } = await supabase.rpc("public_share_link", { p_token: token });
    if (isPublic !== true) redirect(`/join/${token}`);
    const guest = await createGuestSession(supabase);
    if (!guest) redirect(`/join/${token}?error=join`);
  }
  const { data, error } = await supabase.rpc("join_adventure", {
    p_token: token,
  });

  if (error?.code === "42501") {
    redirect(`/join/${token}?error=school`);
  }
  if (error || !data) {
    redirect(`/join/${token}?error=join`);
  }

  redirect(`/play/${data}`);
}
