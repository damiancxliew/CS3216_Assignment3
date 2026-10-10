"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Home, LayoutDashboard } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const organization = Array.isArray(membership?.organization)
    ? membership.organization[0]
    : membership?.organization;
  const roleLabel: Record<OrganizationRole, string> = {
    admin: "Admin",
    teacher: "Teacher",
    student: "Student",
  };
  const roleBadgeStyle: Record<OrganizationRole, string> = {
    admin: "bg-signal-wash text-ink",
    teacher: "bg-world-wash text-world",
    student: "bg-sunken text-muted",
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
  const initials = identity?.name
    ?.trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toLocaleUpperCase() || identity?.email?.trim().slice(0, 1).toLocaleUpperCase() || "U";
  const accountRole = membership
    ? roleLabel[membership.role]
    : isSysadmin
      ? "Sysadmin"
      : null;
  const accountRoleStyle = membership
    ? roleBadgeStyle[membership.role]
    : "bg-spark-wash text-ink";
  const link = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <div className="flex flex-wrap items-center gap-2">
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
      </nav>
      {identity ? (
        <div ref={accountRef} className="relative flex shrink-0 items-center gap-2">
          <span className="hidden h-6 w-px bg-line md:block" aria-hidden />
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Signed in as ${identityTitle} — ${identityContext}`}
            title={`Signed in as ${identityTitle} — ${identityContext}`}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-record"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-record-wash text-sm font-black text-record">{initials}</span>
            <span className="hidden min-w-0 max-w-[12rem] flex-col md:flex">
              <span className="truncate text-sm font-semibold text-ink">{identityName}</span>
              <span className="truncate text-xs text-muted">{organization?.name ?? "No school"}</span>
            </span>
            {accountRole ? (
              <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide md:inline-flex ${accountRoleStyle}`}>
                {accountRole}
              </span>
            ) : null}
            <ChevronDown size={14} aria-hidden className="shrink-0 text-muted" />
          </button>
          {menuOpen ? (
            <div
              id="account-menu"
              role="menu"
              aria-label="Account"
              className="absolute right-0 top-full z-50 mt-2 w-72 rounded-surface border border-line bg-paper p-4 shadow"
            >
              <div>
                <p className="font-semibold text-ink">{identity?.name ?? identity?.email ?? "Account"}</p>
                {identity.email ? <p className="break-all text-sm text-muted">{identity.email}</p> : null}
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">School</p>
                {membership ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">{organization?.name ?? "School"}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${roleBadgeStyle[membership.role]}`}>
                      {roleLabel[membership.role]}
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">No school</p>
                )}
                {isSysadmin ? <span className="mt-2 inline-flex rounded-full bg-spark-wash px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">Sysadmin</span> : null}
              </div>
              <form action="/auth/signout" method="post" className="mt-4 border-t border-line pt-4">
                <button
                  type="submit"
                  role="menuitem"
                  className="w-full rounded-control px-3 py-2 text-left text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-record"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
