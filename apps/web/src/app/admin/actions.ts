"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/app/teacher/actions";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function createSchool(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await getViewer(supabase)).isSysadmin) return { error: "You don’t have permission to create a school." };

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const email = String(formData.get("admin_email") ?? "").trim().toLowerCase();
  if (!name) return { error: "Enter a school name." };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { error: "Enter a valid school slug." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid first admin email." };

  const admin = createAdminClient();
  const { data: organization, error } = await admin.from("organization")
    .insert({ name, slug, created_by: user.id })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: "That slug is taken." };
  if (error || !organization) {
    console.error("could not create school", error);
    return { error: "Could not create this school. Please try again." };
  }

  const { error: inviteError } = await supabase.rpc("invite_staff", {
    p_org: organization.id,
    p_email: email,
    p_role: "admin",
  });
  if (inviteError) {
    console.error("school created but first admin invitation failed", inviteError);
    return { error: "School created, but the first admin invitation could not be added." };
  }
  revalidatePath("/admin");
  return { notice: `Created ${name} and invited its first admin.` };
}
