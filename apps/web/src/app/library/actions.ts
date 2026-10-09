"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function startAdventure(adventureId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_adventure", { p_adventure_id: adventureId });
  if (error || !data) {
    console.error("could not start school adventure", adventureId, error);
    redirect("/library?error=start");
  }
  redirect(`/play/${data}`);
}
