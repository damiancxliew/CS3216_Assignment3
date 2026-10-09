"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function enrollWithSchoolToken(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enroll_with_school_token", { p_token: token });
  if (error) {
    const code = ["42501", "23505", "P0002"].includes(error.code ?? "") ? error.code : "join";
    redirect(`/s/${token}?error=${code}`);
  }
  if (!data) redirect(`/s/${token}?error=join`);
  redirect("/library");
}
