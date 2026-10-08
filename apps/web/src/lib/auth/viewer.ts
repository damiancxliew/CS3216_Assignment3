import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrganizationRole = "admin" | "teacher" | "student";

export type Viewer = {
  user: User | null;
  membership: {
    organizationId: string;
    organizationName: string;
    slug: string;
    role: OrganizationRole;
  } | null;
  isSysadmin: boolean;
};

type MembershipRow = {
  organization_id: string;
  role: OrganizationRole;
  organization: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

export const getViewer = cache(async (supabase: SupabaseClient): Promise<Viewer> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, membership: null, isSysadmin: false };

  const [{ data: member }, { data: platformAdmin, error: platformAdminError }] = await Promise.all([
    supabase
      .from("organization_member")
      .select("organization_id, role, organization(name, slug)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle<MembershipRow>(),
    supabase
      .from("platform_admin")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>(),
  ]);

  const organization = Array.isArray(member?.organization)
    ? member.organization[0]
    : member?.organization;
  let isSysadmin = Boolean(platformAdmin);
  if (platformAdminError) {
    const { data, error } = await supabase.rpc("is_sysadmin");
    if (error) console.error("could not load platform administrator role", error);
    isSysadmin = data === true;
  }

  return {
    user,
    membership: member && organization
      ? {
          organizationId: member.organization_id,
          organizationName: organization.name,
          slug: organization.slug,
          role: member.role,
        }
      : null,
    isSysadmin,
  };
});

export function isStaff(viewer: Pick<Viewer, "membership">): boolean {
  return viewer.membership?.role === "admin" || viewer.membership?.role === "teacher";
}
