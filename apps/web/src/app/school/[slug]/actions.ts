"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/app/teacher/actions";
import { getViewer } from "@/lib/auth/viewer";
import { resolveSchoolContext } from "@/lib/school/context";
import { createClient } from "@/lib/supabase/server";

type SchoolActionContext = NonNullable<Awaited<ReturnType<typeof resolveSchoolContext>>> & {
  supabase: Awaited<ReturnType<typeof createClient>>;
};

async function schoolContext(slug: string, adminOnly = false): Promise<SchoolActionContext | null> {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const context = await resolveSchoolContext(supabase, viewer, slug);
  if (!context || (adminOnly && context.role !== "admin")) return null;
  return { ...context, supabase };
}

function accessError(): ActionResult {
  return { error: "You don’t have permission to manage this school." };
}

function rpcError(error: { code?: string } | null, fallback: string): ActionResult {
  if (error?.code === "23505") return { error: "This student has since joined another school." };
  if (error?.code === "P0001") return { error: "A school must keep at least one active admin." };
  return { error: fallback };
}

function revalidateSchool(slug: string) {
  revalidatePath(`/school/${slug}`);
  revalidatePath("/library");
}

export async function removeStudent(slug: string, userId: string): Promise<ActionResult> {
  const context = await schoolContext(slug);
  if (!context) return accessError();
  const { error } = await context.supabase.rpc("remove_student", {
    p_org: context.organizationId,
    p_user: userId,
  });
  if (error) return rpcError(error, "Could not remove this student. Please try again.");
  revalidateSchool(slug);
  return { notice: "Student removed." };
}

export async function restoreStudent(slug: string, userId: string): Promise<ActionResult> {
  const context = await schoolContext(slug);
  if (!context) return accessError();
  const { error } = await context.supabase.rpc("restore_student", {
    p_org: context.organizationId,
    p_user: userId,
  });
  if (error) return rpcError(error, "Could not restore this student. Please try again.");
  revalidateSchool(slug);
  return { notice: "Student restored." };
}

export async function createSchoolLink(slug: string, _previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await schoolContext(slug);
  if (!context) return accessError();
  const ttlSeconds = Number(formData.get("ttl_seconds"));
  if (![3600, 86400, 604800, 2592000].includes(ttlSeconds)) {
    return { error: "Choose a valid sign-up link duration." };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (Array.from(name).length > 80) return { error: "Link names must be 80 characters or fewer." };
  const { error } = await context.supabase.rpc("create_school_join_link", {
    p_org: context.organizationId,
    p_ttl_seconds: ttlSeconds,
    p_name: name || null,
  });
  if (error) return rpcError(error, "Could not create a sign-up link. Please try again.");
  revalidateSchool(slug);
  return { notice: "Sign-up link created." };
}

export async function revokeSchoolLink(slug: string, linkId: string): Promise<ActionResult> {
  const context = await schoolContext(slug);
  if (!context) return accessError();
  const { error } = await context.supabase.rpc("revoke_school_join_link", { p_link_id: linkId });
  if (error) return rpcError(error, "Could not revoke this sign-up link. Please try again.");
  revalidateSchool(slug);
  revalidatePath(`/school/${slug}/links/${linkId}`);
  return { notice: "Sign-up link revoked." };
}

export async function inviteStaff(slug: string, _previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await schoolContext(slug, true);
  if (!context) return accessError();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  if (!email || !["admin", "teacher"].includes(role)) return { error: "Enter an email and choose a staff role." };
  const { data, error } = await context.supabase.rpc("invite_staff", {
    p_org: context.organizationId,
    p_email: email,
    p_role: role as "admin" | "teacher",
  });
  if (error) return rpcError(error, "Could not invite this staff member. Please try again.");
  revalidateSchool(slug);
  return { notice: data === "invited" ? "Invitation added to the pending list." : "Staff member added." };
}

export async function changeStaffRole(
  slug: string,
  userId: string,
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const context = await schoolContext(slug, true);
  if (!context) return accessError();
  const role = String(formData.get("role") ?? "");
  if (!["admin", "teacher"].includes(role)) return { error: "Choose a valid staff role." };
  const { error } = await context.supabase.rpc("set_member_role", {
    p_org: context.organizationId,
    p_user: userId,
    p_role: role as "admin" | "teacher",
  });
  if (error) return rpcError(error, "Could not change this staff role. Please try again.");
  revalidateSchool(slug);
  return { notice: "Staff role updated." };
}

export async function removeStaffMember(slug: string, userId: string): Promise<ActionResult> {
  const context = await schoolContext(slug, true);
  if (!context) return accessError();
  const { error } = await context.supabase.rpc("remove_staff_member", {
    p_org: context.organizationId,
    p_user: userId,
  });
  if (error) return rpcError(error, "Could not remove this staff member. Please try again.");
  revalidateSchool(slug);
  return { notice: "Staff member removed." };
}

export async function setAdventureArchived(slug: string, adventureId: string, archived: boolean, kind: "v2" | "v3" = "v2"): Promise<ActionResult> {
  const context = await schoolContext(slug, true);
  if (!context) return accessError();
  if (kind !== "v2" && kind !== "v3") return accessError();
  const { error } = kind === "v3"
    ? await context.supabase.rpc("set_adventure_archived_v3", {
        p_org: context.organizationId, p_adventure_id: adventureId, p_archived: archived,
      })
    : await context.supabase.rpc("set_adventure_archived", {
        p_adventure_id: adventureId, p_archived: archived,
      });
  if (error) return rpcError(error, "Could not update this adventure. Please try again.");
  revalidateSchool(slug);
  revalidatePath("/teacher");
  revalidatePath(`${kind === "v3" ? "/v3" : ""}/teacher/${adventureId}`);
  return { notice: archived ? "Adventure archived." : "Adventure unarchived." };
}
