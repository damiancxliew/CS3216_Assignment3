"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Home, LayoutDashboard, UserRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type OrganizationRole = "admin" | "teacher" | "student";
type OrganizationNavigation = { name: string; slug: string };
type MembershipNavigation = {
  role: OrganizationRole;
  organization: OrganizationNavigation | OrganizationNavigation[] | null;
};
type NavigationIdentity = { name: string | null; email: string | null };

export function SiteNavigation() {
  const pathname = usePathname();
  const [membership, setMembership] = useState<MembershipNavigation | null>(null);
  const [isSysadmin, setIsSysadmin] = useState(false);
  const [identity, setIdentity] = useState<NavigationIdentity | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createClient();
    let active = true;
    let revision = 0;
    const loadRole = async (user: User | null | undefined) => {
      const current = ++revision;
      if (!user || user.is_anonymous) {
        if (active) {
          setMembership(null);
          setIsSysadmin(false);
          setIdentity(null);
        }
        return;
      }
      const name = user.user_metadata.full_name ?? user.user_metadata.name ?? null;
      const email = user.email ?? null;
      const [membershipResult, adminResult] = await Promise.all([
        supabase
          .from("organization_member")
          .select("role, organization(name, slug)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle<MembershipNavigation>(),
        supabase
          .from("platform_admin")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle<{ user_id: string }>(),
      ]);
      if (active && current === revision) {
        setMembership(membershipResult.data ?? null);
        setIsSysadmin(Boolean(adminResult.data));
        setIdentity({ name, email });
      }
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        void loadRole(session?.user);
      }, 0);
    });
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      void loadRole(sessionData.session?.user);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const organization = Array.isArray(membership?.organization)
    ? membership.organization[0]
    : membership?.organization;
  const roleLabel: Record<OrganizationRole, string> = {
    admin: "Admin",
    teacher: "Teacher",
    student: "Student",
  };
  const identityContext = membership
    ? `${organization?.name ?? "School"} · ${roleLabel[membership.role]}${isSysadmin ? " · Sysadmin" : ""}`
    : isSysadmin
      ? "Sysadmin"
      : "No school";
  const identityName = identity?.name ?? identity?.email;
  const identityTitle = identity?.name && identity.email
    ? `${identity.name} (${identity.email})`
    : identity?.name ?? identity?.email ?? "User";
  const link = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
      <Link href="/" className={link} aria-current={pathname === "/" ? "page" : undefined}><Home size={16} aria-hidden />Home</Link>
      {membership?.role === "admin" || membership?.role === "teacher" ? (
        <>
          <Link href="/teacher" className={link} aria-current={pathname.startsWith("/teacher") ? "page" : undefined}><LayoutDashboard size={16} aria-hidden />Console</Link>
          {organization ? <Link href={`/school/${encodeURIComponent(organization.slug)}`} className={link} aria-current={pathname.startsWith("/school/") ? "page" : undefined}>School</Link> : null}
        </>
      ) : membership?.role === "student" ? (
        <Link href="/library" className={link} aria-current={pathname.startsWith("/library") ? "page" : undefined}><BookOpen size={16} aria-hidden />Library</Link>
      ) : null}
      {isSysadmin ? (
        <Link href="/admin" className={link} aria-current={pathname.startsWith("/admin") ? "page" : undefined}>Admin</Link>
      ) : null}
      {identity ? (
        <span
          className="inline-flex min-h-11 max-w-[18rem] min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm"
          title={`${identityTitle} — ${identityContext}`}
          aria-label={`Signed in as ${identityTitle} — ${identityContext}`}
        >
          <UserRound size={16} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{identityName}</span>
            <span className="block truncate text-xs text-muted">{identityContext}</span>
          </span>
        </span>
      ) : null}
    </nav>
  );
}
