"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

export async function saveModelPrice(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await getViewer(supabase)).isSysadmin) return { error: "You don’t have permission to manage model prices." };

  const model = String(formData.get("model") ?? "").trim();
  const modelLength = Array.from(model).length;
  if (modelLength < 1 || modelLength > 100) return { error: "Model names must be between 1 and 100 characters." };

  const readPrice = (name: string): number | null => {
    const raw = formData.get(name);
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 10000 ? value : null;
  };
  const input = readPrice("input_usd_per_mtok");
  const cachedInput = readPrice("cached_input_usd_per_mtok");
  const output = readPrice("output_usd_per_mtok");
  if (input === null || cachedInput === null || output === null) {
    return { error: "Enter each price as a number from 0 to 10000 USD per 1M tokens." };
  }

  const { error } = await createAdminClient().from("model_price").upsert({
    model,
    input_usd_per_mtok: input,
    cached_input_usd_per_mtok: cachedInput,
    output_usd_per_mtok: output,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }, { onConflict: "model" });
  if (error) {
    console.error("could not save model price", error);
    return { error: "Could not save this model price. Please try again." };
  }
  revalidatePath("/admin");
  redirect("/admin?tab=pricing");
}

export async function deleteModelPrice(model: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await getViewer(supabase)).isSysadmin) return { error: "You don’t have permission to manage model prices." };

  const trimmedModel = model.trim();
  const modelLength = Array.from(trimmedModel).length;
  if (modelLength < 1 || modelLength > 100) return { error: "Invalid model name." };

  const { error } = await createAdminClient().from("model_price").delete().eq("model", trimmedModel);
  if (error) {
    console.error("could not delete model price", error);
    return { error: "Could not remove this model price. Please try again." };
  }
  revalidatePath("/admin");
  return { notice: `Removed price for ${trimmedModel}.` };
}
