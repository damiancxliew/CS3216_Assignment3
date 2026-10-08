import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateSchoolForm } from "./create-school-form";
import { BarList, ChartCard, DonutChart, LineChart, StackedBarChart, type Point } from "@/components/admin/charts";
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
type ActivityRow = {
  day: string;
  attempts_started: number | string;
  attempts_completed: number | string;
  active_students: number | string;
  play_seconds: number | string;
  new_members: number | string;
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

const PURPOSES = [
  { key: "play", label: "Play", color: "var(--world)" },
  { key: "generation", label: "Generation", color: "var(--spark)" },
  { key: "brief", label: "Brief chat", color: "var(--signal)" },
];

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortMoney(value: number): string {
  return value >= 100 ? `$${compact(value)}` : `$${value.toFixed(value >= 1 || value === 0 ? 2 : 3)}`;
}

function minutes(seconds: number): string {
  return seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : `${Math.round(seconds / 60)} min`;
}

function Metric({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: string }) {
  return (
    <div className="relative flex flex-col gap-1 overflow-hidden rounded-surface border border-line bg-surface p-4 pl-5">
      {accent ? <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: accent }} /> : null}
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-3xl font-extrabold tracking-tight text-ink tabular-nums">{value}</dd>
      {hint ? <dd className="text-sm text-muted">{hint}</dd> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-bold text-ink tabular-nums">{value}</dd>
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
  let activity: ActivityRow[] = [];
  let schools: SchoolRow[] = [];
  let users: Awaited<ReturnType<typeof admin.auth.admin.listUsers>>["data"]["users"] = [];
  const userMemberships = new Map<string, MembershipRow>();
  let sysadmins = new Set<string>();
  let profiles = new Map<string, string>();
  let totalUsers = 0;

  if (tab === "overview") {
    const [overviewResult, dailyResult, activityResult, schoolsResult] = await Promise.all([
      admin.rpc("platform_overview", { p_since: since }),
      admin.rpc("platform_llm_daily", { p_since: since }),
      admin.rpc("platform_activity_daily", { p_since: since }),
      admin.rpc("platform_school_stats", { p_since: since }),
    ]);
    if (overviewResult.error) console.error("could not load platform overview", overviewResult.error);
    if (dailyResult.error) console.error("could not load platform LLM daily usage", dailyResult.error);
    if (activityResult.error) console.error("could not load platform daily activity", activityResult.error);
    if (schoolsResult.error) console.error("could not load platform school stats", schoolsResult.error);
    overview = ((overviewResult.data ?? []) as unknown as MetricRow[])[0] ?? null;
    daily = (dailyResult.data ?? []) as unknown as DailyRow[];
    activity = (activityResult.data ?? []) as unknown as ActivityRow[];
    schools = (schoolsResult.data ?? []) as unknown as SchoolRow[];
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

  const llmDays: Point[] = activity.map((row) => ({
    label: row.day,
    values: Object.fromEntries(daily.filter((entry) => entry.day === row.day).map((entry) => [entry.purpose, number(entry.calls)])),
  }));
  const topSchools = (metric: (school: SchoolRow) => number) => [...schools]
    .sort((left, right) => metric(right) - metric(left))
    .slice(0, 6)
    .map((school) => ({ label: school.name, value: metric(school), href: `/school/${encodeURIComponent(school.slug)}` }));

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
      <nav aria-label="Admin console sections" className="flex gap-2 overflow-x-auto">
        {tabLinks}
      </nav>

      {tab === "overview" ? (
        <div className="flex flex-col gap-8">
          <Section title="Platform overview" lede={`Activity from the last ${days} days.`}>
            <DateWindow days={days} tab={tab} />
            {overview ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric accent="var(--record)" label="Active students" value={compact(number(overview.active_students_since))} hint={`${compact(number(overview.students))} enrolled across ${number(overview.schools)} schools`} />
                  <Metric accent="var(--world)" label="Attempts" value={compact(number(overview.attempts_since))} hint={`${number(overview.attempts_since) ? Math.round((number(overview.completed_since) / number(overview.attempts_since)) * 100) : 0}% completed · ${minutes(number(overview.play_seconds_since))} played`} />
                  <Metric accent="var(--spark)" label="AI spend" value={shortMoney(number(overview.llm_cost_since) + number(overview.image_cost_since))} hint={`${money(overview.llm_cost_since)} LLM · ${money(overview.image_cost_since)} images`} />
                  <Metric accent="var(--signal)" label="LLM calls" value={compact(number(overview.llm_calls_since))} hint={`${compact(number(overview.llm_tokens_since))} tokens · ${number(overview.unpriced_calls_since)} unpriced`} />
                </dl>
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <ChartCard title="Daily activity" summary={`${compact(activity.reduce((sum, row) => sum + number(row.attempts_started), 0))} attempts started`}>
                      <LineChart
                        data={activity.map((row): Point => ({ label: row.day, values: { started: number(row.attempts_started), completed: number(row.attempts_completed), students: number(row.active_students) } }))}
                        series={[
                          { key: "started", label: "Attempts started", color: "var(--record)" },
                          { key: "completed", label: "Completed", color: "var(--world)" },
                          { key: "students", label: "Active students", color: "var(--signal)" },
                        ]}
                        format={compact}
                      />
                    </ChartCard>
                  </div>
                  <ChartCard title="People">
                    <DonutChart
                      center={compact(number(overview.admins) + number(overview.teachers) + number(overview.students))}
                      format={compact}
                      slices={[
                        { label: "Students", value: number(overview.students), color: "var(--record)" },
                        { label: "Teachers", value: number(overview.teachers), color: "var(--world)" },
                        { label: "School admins", value: number(overview.admins), color: "var(--spark)" },
                      ]}
                    />
                    <dl className="mt-2">
                      <MiniStat label="Removed students" value={number(overview.removed_students)} />
                      <MiniStat label="Sysadmins" value={number(overview.sysadmins)} />
                      <MiniStat label="New memberships" value={activity.reduce((sum, row) => sum + number(row.new_members), 0)} />
                    </dl>
                  </ChartCard>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <ChartCard title="LLM calls per day" summary={`${money(overview.llm_cost_since)} priced spend`}>
                      <StackedBarChart data={llmDays} series={PURPOSES} format={compact} />
                    </ChartCard>
                  </div>
                  <ChartCard title="Tokens by purpose">
                    <DonutChart
                      center={compact(number(overview.llm_tokens_since))}
                      format={compact}
                      slices={PURPOSES.map((purpose) => ({ label: purpose.label, value: daily.filter((row) => row.purpose === purpose.key).reduce((sum, row) => sum + number(row.tokens), 0), color: purpose.color }))}
                    />
                  </ChartCard>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <ChartCard title="Top schools by attempts" summary={`last ${days} days`}>
                    {schools.length ? <BarList color="var(--record)" format={compact} rows={topSchools((school) => number(school.attempts_since))} /> : <p className="text-sm text-muted">No schools yet.</p>}
                  </ChartCard>
                  <ChartCard title="Top schools by students">
                    {schools.length ? <BarList color="var(--signal)" format={compact} rows={topSchools((school) => number(school.students))} /> : <p className="text-sm text-muted">No schools yet.</p>}
                  </ChartCard>
                  <ChartCard title="Content">
                    <DonutChart
                      center={compact(number(overview.adventures))}
                      format={compact}
                      slices={[
                        { label: "Published", value: number(overview.published_adventures), color: "var(--world)" },
                        { label: "Draft or archived", value: Math.max(0, number(overview.adventures) - number(overview.published_adventures)), color: "var(--line-strong)" },
                      ]}
                    />
                    <dl className="mt-2">
                      <MiniStat label="All-time attempts" value={compact(number(overview.attempts))} />
                    </dl>
                  </ChartCard>
                </div>
              </>
            ) : <EmptyState title="Platform metrics are unavailable." />}
          </Section>
          <Section title="Daily LLM usage">
            {daily.length ? (
              <details className="rounded-surface border border-line bg-surface">
                <summary className="cursor-pointer px-4 py-3 font-semibold text-ink">Show the table ({daily.length} rows)</summary>
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[42rem] text-left text-sm">
                    <thead className="bg-sunken text-muted"><tr>{["Day", "Purpose", "Calls", "Tokens", "Cost", "Unpriced"].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
                    <tbody>{daily.map((row) => <tr key={`${row.day}-${row.purpose}`} className="border-t border-line">
                      <td className="px-4 py-3">{row.day}</td><td className="px-4 py-3 capitalize">{row.purpose}</td>
                      <td className="px-4 py-3">{number(row.calls)}</td><td className="px-4 py-3">{number(row.tokens)}</td>
                      <td className="px-4 py-3">{money(row.cost_usd)}</td><td className="px-4 py-3">{number(row.unpriced_calls)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </details>
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
