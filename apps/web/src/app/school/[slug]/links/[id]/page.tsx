import Link from "next/link";
import { notFound } from "next/navigation";

import { revokeSchoolLink } from "../../actions";
import { ConfirmActionButton } from "../../confirm-action";
import { SchoolLinkCopy } from "../../school-link-copy";
import { EmptyState, Page, Section, StatusBadge } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { resolveSchoolContext } from "@/lib/school/context";
import { createClient } from "@/lib/supabase/server";

type JoinLinkDetail = {
  id: string;
  token: string;
  name: string | null;
  created_at: string;
  created_by: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

type RosterRow = {
  user_id: string;
  display_name: string | null;
  email: string | null;
};

type SignUpRow = {
  user_id: string;
  status: "active" | "removed";
  created_at: string;
  removed_at: string | null;
};

export default async function SchoolLinkDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const school = await resolveSchoolContext(supabase, viewer, slug);
  if (!school) notFound();

  const { data: link, error: linkError } = await supabase.from("organization_join_link")
    .select("id, token, name, created_at, created_by, expires_at, revoked_at, revoked_by")
    .eq("id", id)
    .eq("organization_id", school.organizationId)
    .maybeSingle<JoinLinkDetail>();
  if (linkError) console.error("could not load school sign-up link", linkError);
  if (!link) notFound();

  const { data: rosterData, error: rosterError } = await supabase.rpc("school_roster", {
    p_org: school.organizationId,
  });
  if (rosterError) console.error("could not load school roster", rosterError);
  const roster = (rosterData ?? []) as unknown as RosterRow[];
  const rosterById = new Map(roster.map((member) => [member.user_id, member]));
  const memberName = (userId: string | null) => {
    if (!userId) return null;
    const member = rosterById.get(userId);
    return member
      ? member.display_name || member.email || "school staff"
      : "a platform admin";
  };

  const { data: signUpData, error: signUpError } = await supabase.from("organization_member")
    .select("user_id, status, created_at, removed_at")
    .eq("organization_id", school.organizationId)
    .eq("joined_via_link", id)
    .order("created_at", { ascending: false })
    .returns<SignUpRow[]>();
  if (signUpError) console.error("could not load sign-ups for school link", signUpError);

  const signUps = (signUpData ?? []).map((signUp) => ({
    ...signUp,
    member: rosterById.get(signUp.user_id),
  }));
  const status = link.revoked_at
    ? "revoked"
    : Date.parse(link.expires_at) > Date.now()
      ? "active"
      : "expired";
  const creator = memberName(link.created_by);
  const revoker = memberName(link.revoked_by);

  return (
    <Page title={link.name || "Sign-up link"} width="wide">
      <Link
        href={`/school/${encodeURIComponent(school.slug)}?tab=links`}
        className="text-base text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
      >
        ← Sign-up links
      </Link>

      <Section title="Link details">
        <div className="flex flex-col gap-5 rounded-surface border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <code
              title={`/s/${link.token}`}
              className="min-w-0 flex-1 truncate rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink"
            >
              /s/{link.token}
            </code>
            <SchoolLinkCopy path={`/s/${link.token}`} />
            <StatusBadge status={status} version={null} />
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-bold uppercase tracking-wide text-muted">Created</dt>
              <dd className="text-sm text-ink">
                {creator ? <>by {creator} · </> : null}
                <time dateTime={link.created_at} title={new Date(link.created_at).toLocaleString()}>
                  {formatDate(link.created_at)}
                </time>
              </dd>
            </div>
            {status !== "revoked" ? (
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">
                  {status === "expired" ? "Expired" : "Expires"}
                </dt>
                <dd className="text-sm text-ink">
                  <time dateTime={link.expires_at} title={new Date(link.expires_at).toLocaleString()}>
                    {formatDate(link.expires_at)}
                  </time>
                </dd>
              </div>
            ) : null}
            {link.revoked_at ? (
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Revoked</dt>
                <dd className="text-sm text-ink">
                  {revoker ? <>by {revoker} · </> : null}
                  <time dateTime={link.revoked_at} title={new Date(link.revoked_at).toLocaleString()}>
                    {formatDate(link.revoked_at)}
                  </time>
                </dd>
              </div>
            ) : null}
          </dl>

          {status === "active" ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <ConfirmActionButton
                action={revokeSchoolLink.bind(null, slug, link.id)}
                label="Revoke"
                confirmMessage={link.name
                  ? `Revoke "${link.name}"? Students won't be able to join with it.`
                  : "Revoke this sign-up link? Students won't be able to join with it."}
              />
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Sign-ups">
        {signUps.length ? (
          <div className="overflow-x-auto rounded-surface border border-line bg-surface">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-muted">
                <tr>
                  {["Name", "Email", "Joined"].map((heading) => (
                    <th key={heading} className="px-3 py-3 font-bold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signUps.map((signUp) => (
                  <tr key={signUp.user_id} className="border-t border-line">
                    <td className="px-3 py-3 font-semibold text-ink">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{signUp.member?.display_name || signUp.member?.email || "Student"}</span>
                        {signUp.status === "removed" ? (
                          <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-muted">Removed</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{signUp.member?.email || "—"}</td>
                    <td className="px-3 py-3 text-muted">
                      <time dateTime={signUp.created_at} title={new Date(signUp.created_at).toLocaleString()}>
                        {formatDate(signUp.created_at)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No one has joined with this link yet." />
        )}
      </Section>
    </Page>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en", { dateStyle: "medium" });
}
