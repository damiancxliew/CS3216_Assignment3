import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserMinus, Users } from "lucide-react";

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
import { StaffRoleSelect } from "./staff-role-select";
import { ActionButton, ActionForm } from "@/components/action-form";
import { SignInButton } from "@/components/sign-in-button";
import { button, EmptyState, Field, Page, Section, SelectField, StatusBadge } from "@/components/ui";
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
type JoinLinkRow = {
  id: string;
  token: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  name: string | null;
};
type JoinerRow = { joined_via_link: string | null };
type InviteRow = { id: string; email: string; role: "admin" | "teacher"; created_at: string };
type UsageRow = {
  kind: "v2" | "v3";
  adventure_id: string;
  share_token: string;
  version_id: string | null;
  shareable: boolean;
  title: string;
  owner_id: string;
  owner_name: string | null;
  status: "briefing" | "generating" | "needs_review" | "failed" | "draft" | "published" | "archived";
  attempts: number;
  students: number;
  school_students: number;
  version_students: number;
  completed: number;
  play_seconds: number | null;
  play_tokens: number;
  image_cost_usd: number | string | null;
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
  const rosterById = new Map(roster.map((member) => [member.user_id, member]));

  let links: JoinLinkRow[] = [];
  let closedLinks: JoinLinkRow[] = [];
  const joinerCountsByLink = new Map<string, number>();
  if (tab === "links") {
    const { data, error } = await supabase.from("organization_join_link")
      .select("id, token, created_at, expires_at, revoked_at, revoked_by, name")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .returns<JoinLinkRow[]>();
    if (error) console.error("could not load school sign-up links", error);
    const allLinks = data ?? [];
    const now = Date.now();
    links = allLinks.filter((link) => !link.revoked_at && Date.parse(link.expires_at) > now);
    closedLinks = allLinks
      .filter((link) => Boolean(link.revoked_at) || Date.parse(link.expires_at) <= now)
      .sort((a, b) => Date.parse(b.revoked_at ?? b.expires_at) - Date.parse(a.revoked_at ?? a.expires_at));

    const { data: joinerData, error: joinerError } = await supabase.from("organization_member")
      .select("joined_via_link")
      .eq("organization_id", organizationId)
      .not("joined_via_link", "is", null)
      .returns<JoinerRow[]>();
    if (joinerError) console.error("could not load sign-up link joiners", joinerError);
    for (const joiner of joinerData ?? []) {
      if (!joiner.joined_via_link) continue;
      joinerCountsByLink.set(
        joiner.joined_via_link,
        (joinerCountsByLink.get(joiner.joined_via_link) ?? 0) + 1,
      );
    }
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
    const { data, error } = await supabase.rpc("school_usage_all_versions", { p_org: organizationId, p_include_v3: true });
    if (error) console.error("could not load school adventure usage", error);
    adventures = (data ?? []) as unknown as UsageRow[];
  }

  return (
    <Page title="School console" width={tab === "adventures" ? "full" : "wide"}>
      <nav aria-label="School console sections" className="flex gap-2 overflow-x-auto">
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
                      triggerClassName={`${button.quiet} w-fit min-w-28`}
                    />
                  ) : (
                    <ActionButton
                      action={restoreStudent.bind(null, slug, student.user_id)}
                      label="Restore"
                      pendingLabel={<span className="sr-only">Restoring…</span>}
                      variant="quiet"
                      className={`${button.quiet} w-fit min-w-28`}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No students yet.">Students can join using a school sign-up link.</EmptyState>}
        </Section>
      ) : null}

      {tab === "links" ? (
        <Section title="Sign-up links" lede="Students can join immediately using any active link.">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <ActionForm
              action={createSchoolLink.bind(null, slug)}
              submitLabel="Create sign-up link"
              pendingLabel="Creating link…"
              className="flex flex-col gap-4 rounded-surface border border-line bg-surface p-5"
            >
              <h3 className="font-bold text-ink">New link</h3>
              <Field name="name" label="Name" optional placeholder="e.g. 3B History" maxLength={80} />
              <SelectField name="ttl_seconds" label="Link duration" options={TTL_OPTIONS} defaultValue="604800" />
            </ActionForm>
            <div className="flex min-w-0 flex-col gap-3">
              {links.length ? (
                <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface">
                  {links.map((link) => (
                    <li key={link.id} className="flex flex-wrap items-center gap-3 p-4">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {link.name ? <p className="font-semibold text-ink">{link.name}</p> : null}
                        <code title={`/s/${link.token}`} className="block truncate rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink">/s/{link.token}</code>
                        <time className="text-sm text-muted" dateTime={link.expires_at} title={new Date(link.expires_at).toLocaleString()}>
                          Expires in {relativeTime(Date.parse(link.expires_at) - Date.now())}
                        </time>
                      </div>
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <LinkDetailsLink slug={slug} linkId={link.id} count={joinerCountsByLink.get(link.id) ?? 0} />
                        <SchoolLinkCopy path={`/s/${link.token}`} />
                        <ConfirmActionButton
                          action={revokeSchoolLink.bind(null, slug, link.id)}
                          label="Revoke"
                          confirmMessage={link.name
                            ? `Revoke "${link.name}"? Students won't be able to join with it.`
                            : "Revoke this sign-up link? Students won't be able to join with it."}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No active sign-up links.">Create a link for students to join your school.</EmptyState>}
              {closedLinks.length ? (
                <details className="rounded-surface border border-line bg-surface">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm text-muted [&::-webkit-details-marker]:hidden">
                    {closedLinks.length} expired or revoked sign-up link{closedLinks.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="flex flex-col divide-y divide-line">
                    {closedLinks.map((link) => {
                      const closedAt = link.revoked_at ?? link.expires_at;
                      const revoker = link.revoked_by ? rosterById.get(link.revoked_by) : null;
                      const revokerName = link.revoked_by
                        ? revoker
                          ? revoker.display_name || revoker.email || "school staff"
                          : "a platform admin"
                        : null;
                      const status = link.revoked_at
                        ? revokerName ? `Revoked by ${revokerName}` : "Revoked"
                        : "Expired";
                      return (
                        <li key={link.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {link.name ? <p className="font-semibold text-ink">{link.name}</p> : null}
                            <code title={`/s/${link.token}`} className="block truncate text-sm text-muted">/s/{link.token}</code>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                              <p>
                                {status} ·{" "}
                                <time dateTime={closedAt} title={new Date(closedAt).toLocaleString()}>
                                  {timeAgo(Date.now() - Date.parse(closedAt))}
                                </time>
                              </p>
                              <LinkDetailsLink slug={slug} linkId={link.id} count={joinerCountsByLink.get(link.id) ?? 0} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : (
                <p className="text-sm text-muted">0 expired or revoked sign-up links.</p>
              )}
            </div>
          </div>
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
                {staff.map((member) => {
                  const name = member.display_name || member.email || "Staff member";
                  return (
                    <li key={member.user_id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div>
                        <p className="font-bold text-ink">{name}</p>
                        {member.display_name ? <p className="text-sm text-muted">{member.email}</p> : null}
                        <p className="text-sm capitalize text-muted">{member.role}</p>
                      </div>
                      {adminRole && member.user_id !== viewerId ? (
                        <div className="flex items-center gap-2">
                          <StaffRoleSelect
                            action={changeStaffRole.bind(null, slug, member.user_id)}
                            email={member.email}
                            defaultValue={member.role === "admin" ? "admin" : "teacher"}
                          />
                          <ConfirmActionButton
                            action={removeStaffMember.bind(null, slug, member.user_id)}
                            label="Remove"
                            icon={<UserMinus aria-hidden className="h-4 w-4" />}
                            ariaLabel={`Remove ${name} from school`}
                            confirmMessage={`Remove ${name} from the school?`}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState title="No other staff members." />}
          </Section>
        </div>
      ) : null}

      {tab === "adventures" && adminRole ? (
        <div className="flex flex-col gap-10">
          {adventures.length === 0 ? <EmptyState title="No school adventures yet." /> : null}
          {(["v3", "v2"] as const).filter((kind) => adventures.some((adventure) => adventure.kind === kind)).map((kind) => (
            <AdventureUsageTable key={kind} slug={slug} kind={kind}
              adventures={adventures.filter((adventure) => adventure.kind === kind)}
              studentCount={adventures.find((adventure) => adventure.kind === kind)?.version_students ?? 0} />
          ))}
        </div>
      ) : null}
    </Page>
  );
}

function usageMetrics(adventure: Pick<UsageRow, "attempts" | "students" | "completed" | "play_seconds" | "play_tokens" | "image_cost_usd">, kind: "v2" | "v3") {
  return [
    { label: "Attempts", value: adventure.attempts.toLocaleString() },
    { label: "Students", value: adventure.students.toLocaleString() },
    { label: "Completed", value: adventure.completed.toLocaleString() },
    ...(kind === "v2" ? [{ label: "Play time", value: playTime(adventure.play_seconds ?? 0) }] : []),
    { label: "Tokens", value: adventure.play_tokens.toLocaleString() },
    ...(kind === "v2" ? [{ label: "Image cost", value: currency(Number(adventure.image_cost_usd)) }] : []),
  ];
}

function AdventureUsageActions({ slug, adventure }: { slug: string; adventure: UsageRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      <SchoolLinkCopy
        path={adventure.kind === "v3" ? `/v3/join/${adventure.version_id}` : `/join/${adventure.share_token}`}
        label={`Copy share link for ${adventure.title}`}
        disabledReason={adventure.shareable && (adventure.kind !== "v3" || adventure.version_id) ? undefined : adventure.status === "archived"
          ? "Archived adventures can't be shared" : adventure.status !== "published"
            ? "Publish this adventure to share it" : "Artwork is still being prepared"}
      />
      {adventure.kind === "v3" ? <Link href={`/v3/teacher/${adventure.adventure_id}/summary`} className={button.subtle}>Results</Link> : null}
      {adventure.kind === "v2" || ["draft", "published", "archived"].includes(adventure.status) ? (
        <ActionButton
          action={setAdventureArchived.bind(null, slug, adventure.adventure_id, adventure.status !== "archived", adventure.kind)}
          label={adventure.status === "archived" ? "Unarchive" : "Archive"}
          pendingLabel={<span className="sr-only">Updating adventure</span>}
          className={button.subtle}
        />
      ) : null}
    </div>
  );
}

function AdventureUsageTitle({ adventure }: { adventure: UsageRow }) {
  return (
    <div className="min-w-0 space-y-1">
      <Link href={adventure.kind === "v3" ? `/v3/teacher/${adventure.adventure_id}` : `/teacher/${adventure.adventure_id}?tab=attempts`}
        className="font-bold leading-snug text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:text-record">
        {adventure.title}
      </Link>
      <p className="truncate text-xs font-normal text-muted" title={adventure.owner_name || "School staff"}>
        By {adventure.owner_name || "School staff"}
      </p>
    </div>
  );
}

function AdventureUsageTable({ slug, adventures, studentCount, kind }: { slug: string; adventures: UsageRow[]; studentCount: number; kind: "v2" | "v3" }) {
  const totals = adventures.reduce((sum, adventure) => ({
    attempts: sum.attempts + adventure.attempts,
    students: studentCount,
    completed: sum.completed + adventure.completed,
    play_seconds: sum.play_seconds + (adventure.play_seconds ?? 0),
    play_tokens: sum.play_tokens + adventure.play_tokens,
    image_cost_usd: sum.image_cost_usd + Number(adventure.image_cost_usd),
  }), { attempts: 0, students: 0, completed: 0, play_seconds: 0, play_tokens: 0, image_cost_usd: 0 });
  const metrics = usageMetrics(totals, kind);
  return (
    <Section title={`${kind.toUpperCase()} adventures`}>
      <div className="hidden overflow-hidden rounded-surface border border-line bg-surface lg:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">{kind.toUpperCase()} school adventures and usage</caption>
          <colgroup>
            <col style={{ width: kind === "v3" ? "36%" : "30%" }} />
            <col style={{ width: "11%" }} />
            {metrics.map(({ label }) => <col key={label} style={{ width: kind === "v3" ? "8%" : "7%" }} />)}
            <col />
          </colgroup>
          <thead className="border-b border-line bg-sunken text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-bold">Adventure / owner</th>
              <th scope="col" className="px-2 py-3 font-bold">Status</th>
              {metrics.map(({ label }) => <th key={label} scope="col" className="px-2 py-3 text-right font-bold">{label}</th>)}
              <th scope="col" className="px-4 py-3 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {adventures.map((adventure) => (
              <tr key={adventure.adventure_id} className="border-b border-line align-middle last:border-b-0">
                <th scope="row" className="px-5 py-5 text-left"><AdventureUsageTitle adventure={adventure} /></th>
                <td className="px-2 py-5"><StatusBadge status={adventure.status} version={null} /></td>
                {usageMetrics(adventure, kind).map(({ label, value }) => <td key={label} className="px-2 py-5 text-right tabular-nums text-ink">{value}</td>)}
                <td className="px-4 py-4"><AdventureUsageActions slug={slug} adventure={adventure} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line-strong bg-sunken font-bold">
            <tr>
              <th scope="row" className="px-5 py-3 text-left" colSpan={2}>Totals</th>
              {metrics.map(({ label, value }) => <td key={label} className="px-2 py-3 text-right tabular-nums">{value}</td>)}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="grid gap-4 lg:hidden">
        {adventures.map((adventure) => (
          <article key={adventure.adventure_id} className="min-w-0 rounded-surface border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><AdventureUsageTitle adventure={adventure} /></div>
              <StatusBadge status={adventure.status} version={null} />
            </div>
            <dl className="my-4 grid grid-cols-2 gap-4 border-y border-line py-4 sm:grid-cols-4">
              {usageMetrics(adventure, kind).map(({ label, value }) => <div key={label}>
                <dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-bold tabular-nums text-ink">{value}</dd>
              </div>)}
            </dl>
            <AdventureUsageActions slug={slug} adventure={adventure} />
          </article>
        ))}
        <div className="rounded-surface bg-sunken p-4">
          <h3 className="mb-3 text-sm font-bold text-ink">Totals</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {metrics.map(({ label, value }) => <div key={label}>
              <dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-bold tabular-nums text-ink">{value}</dd>
            </div>)}
          </dl>
        </div>
      </div>
      {kind === "v3" ? <p className="text-sm text-muted">Play time and image costs are not recorded for V3 adventures.</p> : null}
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

function timeAgo(milliseconds: number) {
  const minutes = Math.max(1, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function LinkDetailsLink({ slug, linkId, count }: { slug: string; linkId: string; count: number }) {
  return (
    <Link
      href={`/school/${encodeURIComponent(slug)}/links/${encodeURIComponent(linkId)}`}
      aria-label="Link details and sign-ups"
      title="Link details and sign-ups"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-sm font-semibold text-muted transition-colors hover:border-ink hover:text-ink"
    >
      <Users aria-hidden className="h-4 w-4" />
      <span>{count}</span>
    </Link>
  );
}

function playTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} m` : `${minutes} m`;
}

function currency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}
