"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** The console currently admits any signed-in, non-anonymous account. */
export function SiteNavigation() {
  const pathname = usePathname();
  const [canAuthor, setCanAuthor] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createClient();
    let active = true;
    // INITIAL_SESSION and subsequent sign-in/sign-out events keep every header in sync.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setCanAuthor(Boolean(session?.user && !session.user.is_anonymous));
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const link = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
      <Link href="/" className={link} aria-current={pathname === "/" ? "page" : undefined}><Home size={16} aria-hidden />Home</Link>
      {canAuthor ? <Link href="/teacher" className={link} aria-current={pathname === "/teacher" ? "page" : undefined}><LayoutDashboard size={16} aria-hidden />Console</Link> : null}
    </nav>
  );
}
