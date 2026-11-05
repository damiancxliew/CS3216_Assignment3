"use server";

import { revalidatePath } from "next/cache";

import { NO_SCHOOL } from "./constants";
import type { ActionResult } from "@/app/teacher/actions";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Role = "admin" | "teacher" | "student";
type Status = "active" | "removed";
type MemberRow = { organization_id: string; role: Role; status: Status };

const ROLES: readonly Role[] = ["admin", "teacher", "student"];
const STATUSES: readonly Status[] = ["active", "removed"];

async function requireSysadmin(): Promise<string | null> {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  return viewer.user && viewer.isSysadmin ? viewer.user.id : null;
}

function denied(): ActionResult {
  return { error: "You don’t have permission to manage access." };
}

function revalidateAccess() {
  revalidatePath("/admin/access");
  revalidatePath("/admin");
  revalidatePath("/library");
}

type Admin = ReturnType<typeof createAdminClient>;

/** True when someone other than `userId` is an active admin of the school. */
async function hasOtherActiveAdmin(admin: Admin, organizationId: string, userId: string): Promise<boolean> {
  const { count, error } = await admin.from("organization_member")
    .select("user_id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .eq("role", "admin")
    .neq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function deactivate(admin: Admin, member: MemberRow, userId: string, actorId: string) {
  const { error } = await admin.from("organization_member")
    .update({ status: "removed", removed_by: actorId, removed_at: new Date().toISOString() })
    .eq("organization_id", member.organization_id)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Places a user in a school with a role and status, or takes them out of their
 * active school. Mirrors the database rules: one active school per user, and
 * every school keeps at least one active admin.
 */
export async function setUserAccess(userId: string, _previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actorId = await requireSysadmin();
  if (!actorId) return denied();

  const organizationId = String(formData.get("organization_id") ?? NO_SCHOOL);
  const role = String(formData.get("role") ?? "") as Role;
  const status = String(formData.get("status") ?? "") as Status;

  const admin = createAdminClient();
  try {
    const { data, error } = await admin.from("organization_member")
      .select("organization_id, role, status")
      .eq("user_id", userId);
    if (error) throw error;
    const memberships = (data ?? []) as MemberRow[];
    const active = memberships.find((row) => row.status === "active") ?? null;

    if (organizationId === NO_SCHOOL) {
      if (!active) return { notice: "This user isn’t in a school." };
      if (active.role === "admin" && !(await hasOtherActiveAdmin(admin, active.organization_id, userId))) {
        return { error: "A school must keep at least one active admin." };
      }
      await deactivate(admin, active, userId, actorId);
      revalidateAccess();
      return { notice: "Removed from school." };
    }

    if (!ROLES.includes(role)) return { error: "Choose a role." };
    if (!STATUSES.includes(status)) return { error: "Choose a status." };

    const { data: school, error: schoolError } = await admin.from("organization")
      .select("id").eq("id", organizationId).maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return { error: "That school no longer exists." };

    const target = memberships.find((row) => row.organization_id === organizationId) ?? null;
    const losesAdmin = target?.status === "active" && target.role === "admin" && (role !== "admin" || status !== "active");
    if (losesAdmin && !(await hasOtherActiveAdmin(admin, organizationId, userId))) {
      return { error: "A school must keep at least one active admin." };
    }

    const moving = status === "active" && active && active.organization_id !== organizationId ? active : null;
    if (moving?.role === "admin" && !(await hasOtherActiveAdmin(admin, moving.organization_id, userId))) {
      return { error: "Their current school would be left without an active admin." };
    }
    if (moving) await deactivate(admin, moving, userId, actorId);

    const now = new Date().toISOString();
    const row = status === "active"
      ? { status, added_by: actorId, removed_by: null, removed_at: null }
      : { status, removed_by: actorId, removed_at: now };
    const { error: upsertError } = await admin.from("organization_member").upsert(
      { organization_id: organizationId, user_id: userId, role, ...row },
      { onConflict: "organization_id,user_id" },
    );
    if (upsertError) {
      if (moving) {
        await admin.from("organization_member")
          .update({ status: "active", removed_by: null, removed_at: null })
          .eq("organization_id", moving.organization_id)
          .eq("user_id", userId);
      }
      if (upsertError.code === "23505") return { error: "This user is already active in another school." };
      throw upsertError;
    }

    revalidateAccess();
    return { notice: moving ? "Moved to the new school." : "Access saved." };
  } catch (error) {
    console.error("could not update user access", error);
    return { error: "Could not save access. Please try again." };
  }
}

export async function setSysadmin(userId: string, enabled: boolean): Promise<ActionResult> {
  const actorId = await requireSysadmin();
  if (!actorId) return denied();
  if (!enabled && userId === actorId) return { error: "You can’t revoke your own sysadmin access." };

  const admin = createAdminClient();
  if (enabled) {
    const { error } = await admin.from("platform_admin").upsert({ user_id: userId });
    if (error) {
      console.error("could not grant sysadmin", error);
      return { error: "Could not grant sysadmin. Please try again." };
    }
  } else {
    const { count, error: countError } = await admin.from("platform_admin")
      .select("user_id", { count: "exact", head: true })
      .neq("user_id", userId);
    if (countError || (count ?? 0) === 0) {
      if (countError) console.error("could not count sysadmins", countError);
      return { error: "The platform must keep at least one sysadmin." };
    }
    const { error } = await admin.from("platform_admin").delete().eq("user_id", userId);
    if (error) {
      console.error("could not revoke sysadmin", error);
      return { error: "Could not revoke sysadmin. Please try again." };
    }
  }
  revalidateAccess();
  return { notice: enabled ? "Sysadmin granted." : "Sysadmin revoked." };
}
