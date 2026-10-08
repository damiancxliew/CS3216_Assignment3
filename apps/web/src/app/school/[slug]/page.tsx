import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  changeStaffRole,
  createSchoolLink,
  inviteStaff,
  removeStaffMember,
  removeStudent,
  restoreStudent,
  revokeSchoolLink,
  setAdventureArchived,
} from "./actions";
import { ConfirmActionButton } from "./confirm-action";
import { SchoolLinkCopy } from "./school-link-copy";
import { ActionButton, ActionForm } from "@/components/action-form";
import { SignInButton } from "@/components/sign-in-button";
import { EmptyState, Field, Page, Section, SelectField, StatusBadge } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { resolveSchoolContext } from "@/lib/school/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "School console", robots: { index: false } };

type Tab = "students" | "links" | "staff" | "adventures";
const STAFF_TABS: { id: Tab; label: string }[] = [
  { id: "students", label: "Students" },
  { id: "links", label: "Sign-up links" },
  { id: "staff", label: "Staff" },
];
const ADMIN_TABS: { id: Tab; label: string }[] = [...STAFF_TABS, { id: "adventures", label: "Adventures" }];
const TTL_OPTIONS = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
];

type MemberRow = {
  user_id: string;
  role: "admin" | "teacher" | "student";
  status: "active" | "removed";
  display_name: string | null;
  email: string | null;
  joined_at: string;
  removed_at: string | null;
};
type JoinLinkRow = { id: string; token: string; expires_at: string; revoked_at: string | null };
type InviteRow = { id: string; email: string; role: "admin" | "teacher"; created_at: string };
type UsageRow = {
  adventure_id: string;
  title: string;
  owner_id: string;
  owner_name: string | null;
  status: "draft" | "published" | "archived";
  attempts: number;
  students: number;
  completed: number;
  play_seconds: number;
  play_tokens: number;
  image_cost_usd: number | string;
  updated_at: string;
};

export default async function SchoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user) {
    return (
      <Page title="School console" lede="Sign in to manage your school.">
        <SignInButton next={`/school/${encodeURIComponent(slug)}`} label="Sign in with Google" />
      </Page>
    );
  }
  const viewerId = viewer.user.id;
  const school = await resolveSchoolContext(supabase, viewer, slug);
  if (!school) notFound();

  const adminRole = school.role === "admin";
  const tabs = adminRole ? ADMIN_TABS : STAFF_TABS;
  const tab = tabs.find((item) => item.id === query.tab)?.id ?? "students";
  const organizationId = school.organizationId;
  const { data: rosterData, error: rosterError } = await supabase.rpc("school_roster", { p_org: organizationId });
  if (rosterError) console.error("could not load school roster", rosterError);
  const roster = (rosterData ?? []) as unknown as MemberRow[];
  const students = roster.filter((member) => member.role === "student");
  const staff = roster.filter((member) => member.role === "admin" || member.role === "teacher");

  let links: JoinLinkRow[] = [];
  let closedLinkCount = 0;
  if (tab === "links") {
    const { data, error } = await supabase.from("organization_join_link")
      .select("id, token, expires_at, revoked_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .returns<JoinLinkRow[]>();
    if (error) console.error("could not load school sign-up links", error);
    const allLinks = data ?? [];
    const now = Date.now();
    links = allLinks.filter((link) => !link.revoked_at && Date.parse(link.expires_at) > now);
    closedLinkCount = allLinks.length - links.length;
  }

  let invitations: InviteRow[] = [];
  if (tab === "staff" && adminRole) {
    const { data, error } = await supabase.from("organization_invite")
      .select("id, email, role, created_at")
      .eq("organization_id", organizationId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .returns<InviteRow[]>();
    if (error) console.error("could not load pending staff invitations", error);
    invitations = data ?? [];
  }

  let adventures: UsageRow[] = [];
  if (tab === "adventures" && adminRole) {
    const { data, error } = await supabase.rpc("school_usage", { p_org: organizationId });
    if (error) console.error("could not load school adventure usage", error);
    adventures = (data ?? []) as unknown as UsageRow[];
  }

  return (
<<<<<<< HEAD
    <Page kicker={school.name} title="School console" width="wide">
      <nav aria-label="School console sections" className="flex gap-2 overflow-x-auto border-b border-line pb-2">
||||||| 57a19bb
    <Page kicker={membership.organizationName} title="School console" width="wide">
      <nav aria-label="School console sections" className="flex gap-2 overflow-x-auto border-b border-line pb-2">
=======
    <Page kicker={membership.organizationName} title="School console" width="wide">
      <nav aria-label="School console sections" className="flex gap-2 overflow-x-auto">
>>>>>>> origin/devin/1791473581-rbac-school
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={`/school/${encodeURIComponent(slug)}?tab=${item.id}`}
            aria-current={tab === item.id ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-control px-4 text-base font-semibold transition-colors ${tab === item.id ? "bg-ink text-paper" : "text-muted hover:bg-surface hover:text-ink"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "students" ? (
        <Section title="Students" lede="Manage students who belong to your school.">
          {students.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface">
              {students.map((student) => (
                <li key={student.user_id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{student.display_name || student.email || "Student"}</p>
                    {student.display_name ? <p className="text-sm text-muted">{student.email}</p> : null}
                    <p className="text-sm text-muted">Joined {formatDate(student.joined_at)}</p>
                    {student.status === "removed" && student.removed_at ? <p className="text-sm text-muted">Removed {formatDate(student.removed_at)}</p> : null}
                    <p className={`mt-1 text-xs font-bold uppercase tracking-wide ${student.status === "active" ? "text-world" : "text-muted"}`}>{student.status}</p>
                  </div>
                  {student.status === "active" ? (
                    <ConfirmActionButton
                      action={removeStudent.bind(null, slug, student.user_id)}
                      label="Remove"
                      confirmMessage={`Remove ${student.display_name || student.email || "this student"} from your school?`}
                    />
                  ) : (
                    <ActionButton action={restoreStudent.bind(null, slug, student.user_id)} label="Restore" pendingLabel="Restoring…" variant="quiet" />
                  )}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No students yet.">Students can join using a school sign-up link.</EmptyState>}
        </Section>
      ) : null}

      {tab === "links" ? (
        <Section title="Sign-up links" lede="Students can join immediately using any active link.">
          <ActionForm
            action={createSchoolLink.bind(null, slug)}
            submitLabel="Create sign-up link"
            pendingLabel="Creating link…"
            className="flex max-w-xl flex-col gap-4 rounded-surface border border-line bg-surface p-5"
          >
            <SelectField name="ttl_seconds" label="Link duration" options={TTL_OPTIONS} defaultValue="604800" />
          </ActionForm>
          {links.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface">
              {links.map((link) => (
                <li key={link.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-2">
                    <SchoolLinkCopy token={link.token} />
                    <time className="text-sm text-muted" dateTime={link.expires_at} title={new Date(link.expires_at).toLocaleString()}>
                      Expires in {relativeTime(Date.parse(link.expires_at) - Date.now())}
                    </time>
                  </div>
                  <ActionButton action={revokeSchoolLink.bind(null, slug, link.id)} label="Revoke" pendingLabel="Revoking…" variant="quiet" />
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No active sign-up links.">Create a link for students to join your school.</EmptyState>}
          <p className="text-sm text-muted">{closedLinkCount} expired or revoked sign-up link{closedLinkCount === 1 ? "" : "s"}.</p>
        </Section>
      ) : null}

      {tab === "staff" ? (
        <div className="flex flex-col gap-8">
          {adminRole ? (
            <Section title="Invite staff" lede="Invite a school admin or teacher by email.">
              <ActionForm action={inviteStaff.bind(null, slug)} submitLabel="Invite staff" pendingLabel="Saving invitation…" className="grid max-w-2xl gap-4 rounded-surface border border-line bg-surface p-5 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
                <Field name="email" label="Email" type="email" placeholder="teacher@example.com" />
                <SelectField name="role" label="Role" options={[{ value: "teacher", label: "Teacher" }, { value: "admin", label: "Admin" }]} defaultValue="teacher" />
              </ActionForm>
              <Section title="Pending invitations">
                {invitations.length ? (
                  <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface">
                    {invitations.map((invite) => (
                      <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span className="font-semibold text-ink">{invite.email}</span>
                        <span className="text-sm text-muted">{invite.role} · invited {formatDate(invite.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="No pending invitations." />}
              </Section>
            </Section>
          ) : null}
          <Section title="School staff">
            {staff.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface">
                {staff.map((member) => (
                  <li key={member.user_id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div>
                      <p className="font-bold text-ink">{member.display_name || member.email || "Staff member"}</p>
                      {member.display_name ? <p className="text-sm text-muted">{member.email}</p> : null}
                      <p className="text-sm capitalize text-muted">{member.role}</p>
                    </div>
                    {adminRole && member.user_id !== viewerId ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <ActionForm action={changeStaffRole.bind(null, slug, member.user_id)} submitLabel="Save role" pendingLabel="Saving…" className="flex flex-wrap items-end gap-2">
                          <SelectField name="role" label={`Role for ${member.email ?? "staff member"}`} options={[{ value: "teacher", label: "Teacher" }, { value: "admin", label: "Admin" }]} defaultValue={member.role} />
                        </ActionForm>
                        <ActionButton action={removeStaffMember.bind(null, slug, member.user_id)} label="Remove from school" pendingLabel="Removing…" variant="quiet" />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No other staff members." />}
          </Section>
        </div>
      ) : null}

      {tab === "adventures" && adminRole ? <AdventureUsageTable slug={slug} adventures={adventures} /> : null}
    </Page>
  );
}

function AdventureUsageTable({ slug, adventures }: { slug: string; adventures: UsageRow[] }) {
  const totals = adventures.reduce((sum, adventure) => ({
    attempts: sum.attempts + adventure.attempts,
    students: sum.students + adventure.students,
    completed: sum.completed + adventure.completed,
    play_seconds: sum.play_seconds + adventure.play_seconds,
    play_tokens: sum.play_tokens + adventure.play_tokens,
    image_cost_usd: sum.image_cost_usd + Number(adventure.image_cost_usd),
  }), { attempts: 0, students: 0, completed: 0, play_seconds: 0, play_tokens: 0, image_cost_usd: 0 });
  return (
    <Section title="School adventures" lede="Read-only activity and cost oversight for your school.">
      {adventures.length ? (
        <div className="overflow-x-auto rounded-surface border border-line bg-surface">
          <table className="w-full min-w-[68rem] border-collapse text-left text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-muted">
              <tr>{["Adventure", "Owner", "Status", "Attempts", "Students", "Completed", "Play time", "Tokens", "Image cost", ""].map((heading, index) => <th key={`${heading}-${index}`} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {adventures.map((adventure) => (
                <tr key={adventure.adventure_id} className="border-t border-line">
                  <td className="px-3 py-3 font-semibold text-ink">{adventure.title}</td>
                  <td className="px-3 py-3 text-muted">{adventure.owner_name || "School staff"}</td>
                  <td className="px-3 py-3"><StatusBadge status={adventure.status} version={null} /></td>
                  <td className="px-3 py-3 tabular-nums">{adventure.attempts}</td>
                  <td className="px-3 py-3 tabular-nums">{adventure.students}</td>
                  <td className="px-3 py-3 tabular-nums">{adventure.completed}</td>
                  <td className="px-3 py-3 tabular-nums">{playTime(adventure.play_seconds)}</td>
                  <td className="px-3 py-3 tabular-nums">{adventure.play_tokens.toLocaleString()}</td>
                  <td className="px-3 py-3 tabular-nums">{currency(Number(adventure.image_cost_usd))}</td>
                  <td className="px-3 py-3">
                    <ActionButton
                      action={setAdventureArchived.bind(null, slug, adventure.adventure_id, adventure.status !== "archived")}
                      label={adventure.status === "archived" ? "Unarchive" : "Archive"}
                      pendingLabel="Updating…"
                      variant="quiet"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line-strong bg-sunken font-bold">
              <tr>
                <td className="px-3 py-3" colSpan={3}>Totals</td>
                <td className="px-3 py-3 tabular-nums">{totals.attempts}</td>
                <td className="px-3 py-3 tabular-nums">{totals.students}</td>
                <td className="px-3 py-3 tabular-nums">{totals.completed}</td>
                <td className="px-3 py-3 tabular-nums">{playTime(totals.play_seconds)}</td>
                <td className="px-3 py-3 tabular-nums">{totals.play_tokens.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums">{currency(totals.image_cost_usd)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : <EmptyState title="No school adventures yet." />}
    </Section>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en", { dateStyle: "medium" });
}

function relativeTime(milliseconds: number) {
  const hours = Math.max(1, Math.ceil(milliseconds / 3_600_000));
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function playTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} m` : `${minutes} m`;
}

function currency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}
