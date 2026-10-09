"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Home, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type OrganizationRole = "admin" | "teacher" | "student";

export function SiteNavigation() {
  const pathname = usePathname();
  const [role, setRole] = useState<OrganizationRole | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createClient();
    let active = true;
    let revision = 0;
    const loadRole = async (userId: string | undefined, anonymous: boolean) => {
      const current = ++revision;
      if (!userId || anonymous) {
        if (active) setRole(null);
        return;
      }
      const { data } = await supabase
        .from("organization_member")
        .select("role")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle<{ role: OrganizationRole }>();
      if (active && current === revision) setRole(data?.role ?? null);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        void loadRole(session?.user.id, session?.user.is_anonymous ?? false);
      }, 0);
    });
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      void loadRole(sessionData.session?.user.id, sessionData.session?.user.is_anonymous ?? false);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const link = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
      <Link href="/" className={link} aria-current={pathname === "/" ? "page" : undefined}><Home size={16} aria-hidden />Home</Link>
      {role === "admin" || role === "teacher" ? (
        <Link href="/teacher" className={link} aria-current={pathname.startsWith("/teacher") ? "page" : undefined}><LayoutDashboard size={16} aria-hidden />Console</Link>
      ) : role === "student" ? (
        <Link href="/library" className={link} aria-current={pathname.startsWith("/library") ? "page" : undefined}><BookOpen size={16} aria-hidden />Library</Link>
      ) : null}
    </nav>
  );
}
