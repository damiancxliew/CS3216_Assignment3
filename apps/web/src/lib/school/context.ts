import type { SupabaseClient } from "@supabase/supabase-js";

import { isStaff, type OrganizationRole, type Viewer } from "@/lib/auth/viewer";

export type SchoolContext = {
  organizationId: string;
  name: string;
  slug: string;
  role: OrganizationRole;
};

export async function resolveSchoolContext(
  supabase: SupabaseClient,
  viewer: Viewer,
  slug: string,
): Promise<SchoolContext | null> {
  if (!viewer.user) return null;
  if (isStaff(viewer) && viewer.membership?.slug === slug) {
    return {
      organizationId: viewer.membership.organizationId,
      name: viewer.membership.organizationName,
      slug: viewer.membership.slug,
      role: viewer.membership.role,
    };
  }
  if (!viewer.isSysadmin) return null;

  const { data, error } = await supabase
    .from("organization")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle<{ id: string; name: string; slug: string }>();
  if (error) {
    console.error("could not resolve school context", error);
    return null;
  }
  return data
    ? { organizationId: data.id, name: data.name, slug: data.slug, role: "admin" }
    : null;
}
