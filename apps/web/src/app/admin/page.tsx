import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateSchoolForm } from "./create-school-form";
import { SignInButton } from "@/components/sign-in-button";
import { EmptyState, Page, Section } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin console", robots: { index: false } };

type Tab = "overview" | "schools" | "users";
type MetricRow = Record<string, number | string>;
type SchoolRow = {
  organization_id: string;
  name: string;
  slug: string;
  admins: number | string;
  teachers: number | string;
  students: number | string;
  adventures: number | string;
  published: number | string;
  attempts: number | string;
  attempts_since: number | string;
  llm_cost_since: number | string;
  image_cost: number | string;
};
type DailyRow = {
  day: string;
  purpose: string;
  calls: number | string;
  tokens: number | string;
  cost_usd: number | string;
  unpriced_calls: number | string;
};
type MembershipRow = {
  user_id: string;
  role: string;
  status: string;
  organization: { name: string } | { name: string }[] | null;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "schools", label: "Schools" },
  { id: "users", label: "Users" },
];

function number(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function money(value: number | string | null | undefined): string {
  return `$${number(value).toFixed(4)}`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-2 rounded-surface border border-line bg-surface p-4">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-2xl font-extrabold tracking-tight text-ink">{value}</dd>
    </div>
  );
}

function DateWindow({ days, tab }: { days: number; tab: Tab }) {
  return (
    <nav aria-label="Metrics date range" className="flex gap-2">
      {[7, 30, 90].map((option) => (
        <Link
          key={option}
          href={`/admin?tab=${tab}&days=${option}`}
          aria-current={days === option ? "page" : undefined}
          className={`rounded-full border px-4 py-2 text-sm font-semibold ${days === option ? "border-ink bg-ink text-paper" : "border-line-strong text-muted hover:bg-surface"}`}
        >
          {option} days
        </Link>
      ))}
    </nav>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; days?: string; page?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user) {
    return (
      <Page title="Admin console" lede="Sign in to access platform administration.">
        <SignInButton next="/admin" label="Sign in with Google" />
      </Page>
    );
  }
  if (!viewer.isSysadmin) notFound();

  const admin = createAdminClient();
  const tab: Tab = TABS.some((item) => item.id === query.tab) ? query.tab as Tab : "overview";
  const days = ["7", "30", "90"].includes(query.days ?? "") ? Number(query.days) : 30;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let overview: MetricRow | null = null;
  let daily: DailyRow[] = [];
  let schools: SchoolRow[] = [];
  let users: Awaited<ReturnType<typeof admin.auth.admin.listUsers>>["data"]["users"] = [];
  const userMemberships = new Map<string, MembershipRow>();
  let sysadmins = new Set<string>();
  let profiles = new Map<string, string>();
  let totalUsers = 0;

  if (tab === "overview") {
    const [overviewResult, dailyResult] = await Promise.all([
      admin.rpc("platform_overview", { p_since: since }),
      admin.rpc("platform_llm_daily", { p_since: since }),
    ]);
    if (overviewResult.error) console.error("could not load platform overview", overviewResult.error);
    if (dailyResult.error) console.error("could not load platform LLM daily usage", dailyResult.error);
    overview = ((overviewResult.data ?? []) as unknown as MetricRow[])[0] ?? null;
    daily = (dailyResult.data ?? []) as unknown as DailyRow[];
  } else if (tab === "schools") {
    const { data, error } = await admin.rpc("platform_school_stats", { p_since: since });
    if (error) console.error("could not load platform school stats", error);
    schools = (data ?? []) as unknown as SchoolRow[];
  } else {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) console.error("could not load platform users", error);
    users = data?.users ?? [];
    totalUsers = data && "total" in data ? data.total ?? 0 : users.length;
    const ids = users.map((user) => user.id);
    if (ids.length) {
      const [membersResult, adminsResult, profilesResult] = await Promise.all([
        admin.from("organization_member")
          .select("user_id, role, status, organization(name)")
          .in("user_id", ids),
        admin.from("platform_admin").select("user_id").in("user_id", ids),
        admin.from("profile").select("id, display_name").in("id", ids),
      ]);
      if (membersResult.error) console.error("could not load user memberships", membersResult.error);
      if (adminsResult.error) console.error("could not load platform admin flags", adminsResult.error);
      if (profilesResult.error) console.error("could not load user profiles", profilesResult.error);
      for (const row of (membersResult.data ?? []) as unknown as MembershipRow[]) {
        const existing = userMemberships.get(row.user_id);
        if (!existing || row.status === "active") userMemberships.set(row.user_id, row);
      }
      sysadmins = new Set((adminsResult.data ?? []).map((row) => row.user_id));
      profiles = new Map((profilesResult.data ?? []).map((row) => [row.id, row.display_name ?? ""]));
    }
  }

  const tabLinks = TABS.map((item) => (
    <Link
      key={item.id}
      href={`/admin?tab=${item.id}&days=${days}`}
      aria-current={tab === item.id ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-control px-4 text-base font-semibold ${tab === item.id ? "bg-ink text-paper" : "text-muted hover:bg-surface hover:text-ink"}`}
    >
      {item.label}
    </Link>
  ));

  return (
    <Page title="Admin console" lede="Platform-wide schools, users, and usage." width="wide">
      <nav aria-label="Admin console sections" className="flex gap-2 overflow-x-auto border-b border-line pb-2">
        {tabLinks}
      </nav>

      {tab === "overview" ? (
        <div className="flex flex-col gap-8">
          <Section title="Platform overview" lede={`Activity from the last ${days} days.`}>
            <DateWindow days={days} tab={tab} />
            {overview ? (
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Schools" value={number(overview.schools)} />
                <Metric label="School admins" value={number(overview.admins)} />
                <Metric label="Teachers" value={number(overview.teachers)} />
                <Metric label="Active students" value={number(overview.students)} />
                <Metric label="Removed students" value={number(overview.removed_students)} />
                <Metric label="Sysadmins" value={number(overview.sysadmins)} />
                <Metric label="Adventures" value={number(overview.adventures)} />
                <Metric label="Published adventures" value={number(overview.published_adventures)} />
                <Metric label="All attempts" value={number(overview.attempts)} />
                <Metric label="Attempts in window" value={number(overview.attempts_since)} />
                <Metric label="Completed in window" value={number(overview.completed_since)} />
                <Metric label="Active students in window" value={number(overview.active_students_since)} />
                <Metric label="Play time in window" value={`${Math.round(number(overview.play_seconds_since) / 60)} min`} />
                <Metric label="LLM calls" value={number(overview.llm_calls_since)} />
                <Metric label="LLM tokens" value={number(overview.llm_tokens_since)} />
                <Metric label="LLM cost" value={money(overview.llm_cost_since)} />
                <Metric label="Unpriced calls" value={number(overview.unpriced_calls_since)} />
                <Metric label="Image cost" value={money(overview.image_cost_since)} />
              </dl>
            ) : <EmptyState title="Platform metrics are unavailable." />}
          </Section>
          <Section title="Daily LLM usage">
            {daily.length ? (
              <div className="overflow-x-auto rounded-surface border border-line">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="bg-sunken text-muted"><tr>{["Day", "Purpose", "Calls", "Tokens", "Cost", "Unpriced"].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
                  <tbody>{daily.map((row) => <tr key={`${row.day}-${row.purpose}`} className="border-t border-line">
                    <td className="px-4 py-3">{row.day}</td><td className="px-4 py-3 capitalize">{row.purpose}</td>
                    <td className="px-4 py-3">{number(row.calls)}</td><td className="px-4 py-3">{number(row.tokens)}</td>
                    <td className="px-4 py-3">{money(row.cost_usd)}</td><td className="px-4 py-3">{number(row.unpriced_calls)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            ) : <EmptyState title="No LLM usage in this window." />}
          </Section>
        </div>
      ) : null}

      {tab === "schools" ? (
        <div className="flex flex-col gap-8">
          <Section title="Schools" lede="School activity and costs across the platform.">
            <DateWindow days={days} tab={tab} />
            {schools.length ? (
              <div className="overflow-x-auto rounded-surface border border-line">
                <table className="w-full min-w-[55rem] text-left text-sm">
                  <thead className="bg-sunken text-muted"><tr>{["School", "Admins", "Teachers", "Students", "Adventures", "Published", "Attempts", "Attempts in window", "LLM cost", "Image cost"].map((label) => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
                  <tbody>{schools.map((school) => <tr key={school.organization_id} className="border-t border-line">
                    <td className="px-3 py-3 font-semibold"><Link className="underline decoration-line-strong underline-offset-4 hover:text-record" href={`/school/${encodeURIComponent(school.slug)}`}>{school.name}</Link></td>
                    <td className="px-3 py-3">{number(school.admins)}</td><td className="px-3 py-3">{number(school.teachers)}</td>
                    <td className="px-3 py-3">{number(school.students)}</td><td className="px-3 py-3">{number(school.adventures)}</td>
                    <td className="px-3 py-3">{number(school.published)}</td><td className="px-3 py-3">{number(school.attempts)}</td>
                    <td className="px-3 py-3">{number(school.attempts_since)}</td><td className="px-3 py-3">{money(school.llm_cost_since)}</td>
                    <td className="px-3 py-3">{money(school.image_cost)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            ) : <EmptyState title="No schools found." />}
          </Section>
          <Section title="Create a school" lede="Create the school and send an invitation to its first admin.">
            <CreateSchoolForm />
          </Section>
        </div>
      ) : null}

      {tab === "users" ? (
        <Section title="Users" lede="Read-only account, school, and platform-admin status. Sysadmin grants are managed by the CLI.">
          {users.length ? (
            <>
              <div className="overflow-x-auto rounded-surface border border-line">
                <table className="w-full min-w-[68rem] text-left text-sm">
                  <thead className="bg-sunken text-muted"><tr>{["Email", "Name", "School", "Role", "Status", "Sysadmin", "Created", "Last sign-in"].map((label) => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
                  <tbody>{users.map((user) => {
                    const membership = userMemberships.get(user.id);
                    const organization = Array.isArray(membership?.organization) ? membership.organization[0] : membership?.organization;
                    const name = profiles.get(user.id) || String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? "");
                    return <tr key={user.id} className="border-t border-line">
                      <td className="px-3 py-3">{user.email ?? "—"}</td><td className="px-3 py-3">{name || "—"}</td>
                      <td className="px-3 py-3">{organization?.name ?? "—"}</td><td className="px-3 py-3 capitalize">{membership?.role ?? "—"}</td>
                      <td className="px-3 py-3 capitalize">{membership?.status ?? "—"}</td><td className="px-3 py-3">{sysadmins.has(user.id) ? "Yes" : "No"}</td>
                      <td className="px-3 py-3">{user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-3">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : "—"}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <nav aria-label="User pages" className="flex items-center justify-between">
                <span className="text-sm text-muted">Page {page} of {Math.max(1, Math.ceil(totalUsers / 50))}</span>
                <div className="flex gap-3">
                  {page > 1 ? <Link className="underline underline-offset-4" href={`/admin?tab=users&page=${page - 1}`}>Previous</Link> : null}
                  {page * 50 < totalUsers ? <Link className="underline underline-offset-4" href={`/admin?tab=users&page=${page + 1}`}>Next</Link> : null}
                </div>
              </nav>
            </>
          ) : <EmptyState title="No users found." />}
        </Section>
      ) : null}
    </Page>
  );
}
