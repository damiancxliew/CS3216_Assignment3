import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessRow, type AccessRowProps } from "./access-row";
import { SignInButton } from "@/components/sign-in-button";
import { EmptyState, Page, Section } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Manage access", robots: { index: false } };

const PER_PAGE = 50;

type MemberRow = {
  user_id: string;
  organization_id: string;
  role: "admin" | "teacher" | "student";
  status: "active" | "removed";
  updated_at: string;
};

export default async function AdminAccessPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user) {
    return (
      <Page title="Manage access" lede="Sign in to access platform administration.">
        <SignInButton next="/admin/access" label="Sign in with Google" />
      </Page>
    );
  }
  if (!viewer.isSysadmin) notFound();

  const admin = createAdminClient();
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const [usersResult, schoolsResult] = await Promise.all([
    admin.auth.admin.listUsers({ page, perPage: PER_PAGE }),
    admin.from("organization").select("id, name").order("name"),
  ]);
  if (usersResult.error) console.error("could not load platform users", usersResult.error);
  if (schoolsResult.error) console.error("could not load schools", schoolsResult.error);
  const users = usersResult.data?.users ?? [];
  const totalUsers = usersResult.data && "total" in usersResult.data ? usersResult.data.total ?? 0 : users.length;
  const schools = (schoolsResult.data ?? []) as { id: string; name: string }[];

  const memberships = new Map<string, MemberRow>();
  let sysadmins = new Set<string>();
  let profiles = new Map<string, string>();
  const ids = users.map((user) => user.id);
  if (ids.length) {
    const [membersResult, adminsResult, profilesResult] = await Promise.all([
      admin.from("organization_member").select("user_id, organization_id, role, status, updated_at").in("user_id", ids),
      admin.from("platform_admin").select("user_id").in("user_id", ids),
      admin.from("profile").select("id, display_name").in("id", ids),
    ]);
    if (membersResult.error) console.error("could not load user memberships", membersResult.error);
    if (adminsResult.error) console.error("could not load platform admin flags", adminsResult.error);
    if (profilesResult.error) console.error("could not load user profiles", profilesResult.error);
    // Show the active membership, otherwise the most recently changed one.
    for (const row of (membersResult.data ?? []) as MemberRow[]) {
      const existing = memberships.get(row.user_id);
      if (!existing || existing.status !== "active" && (row.status === "active" || row.updated_at > existing.updated_at)) {
        memberships.set(row.user_id, row);
      }
    }
    sysadmins = new Set((adminsResult.data ?? []).map((row) => row.user_id));
    profiles = new Map((profilesResult.data ?? []).map((row) => [row.id, row.display_name ?? ""]));
  }

  const rows: AccessRowProps[] = users.map((user) => {
    const membership = memberships.get(user.id);
    return {
      userId: user.id,
      email: user.email ?? null,
      name: profiles.get(user.id) || String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""),
      schools,
      membership: membership
        ? { organizationId: membership.organization_id, role: membership.role, status: membership.status }
        : null,
      isSysadmin: sysadmins.has(user.id),
      isSelf: user.id === viewer.user?.id,
    };
  });

  return (
    <Page
      title="Manage access"
      lede="Assign users to a school with a role and status, and grant sysadmin. Active members can play their school’s adventures."
      width="wide"
      kicker={<Link className="underline underline-offset-4" href="/admin?tab=users">← Admin console</Link>}
    >
      <Section title="Users">
        {rows.length ? (
          <>
            <div className="overflow-x-auto rounded-surface border border-line">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <thead className="bg-sunken text-muted">
                  <tr>{["User", "School", "Role", "Status", "Sysadmin", ""].map((label) => (
                    <th key={label || "save"} className="px-3 py-3 font-semibold">{label}</th>
                  ))}</tr>
                </thead>
                <tbody>{rows.map((row) => <AccessRow key={row.userId} {...row} />)}</tbody>
              </table>
            </div>
            <nav aria-label="User pages" className="flex items-center justify-between">
              <span className="text-sm text-muted">Page {page} of {Math.max(1, Math.ceil(totalUsers / PER_PAGE))}</span>
              <div className="flex gap-3">
                {page > 1 ? <Link className="underline underline-offset-4" href={`/admin/access?page=${page - 1}`}>Previous</Link> : null}
                {page * PER_PAGE < totalUsers ? <Link className="underline underline-offset-4" href={`/admin/access?page=${page + 1}`}>Next</Link> : null}
              </div>
            </nav>
          </>
        ) : <EmptyState title="No users found." />}
      </Section>
    </Page>
  );
}
