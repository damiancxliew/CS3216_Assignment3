"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

import { v3PublishDeps } from "@/lib/play/v3/http";

export async function setAdventurePublic(id: string, kind: "v2" | "v3", isPublic: boolean) {
  if (kind === "v3") {
    const adventure = await v3PublishDeps().store.loadAdventure(id);
    if (!adventure) return { ok: false };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_adventure_public", { p_id: id, p_kind: kind, p_public: isPublic });
  if (error) return { ok: false };
  revalidatePath(`/teacher/${id}`);
  revalidatePath(`/v3/teacher/${id}`, "layout");
  revalidatePath(`/v3/join/${id}`);
  return { ok: true };
}
