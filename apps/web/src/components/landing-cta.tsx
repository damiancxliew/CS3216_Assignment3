"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SignInButton } from "@/components/sign-in-button";
import { button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/**
 * The landing page stays a statically prerendered client component, so it
 * cannot read the session from cookies the way the server components around
 * the other `SignInButton` call sites do. Resolve auth in the browser instead:
 * signed-out visitors get the Google CTA, signed-in ones a straight link to
 * the console.
 */
export function LandingCta({ label }: { label?: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setSignedIn(false);
      return;
    }
    const supabase = createClient();
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.user));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Nothing decided yet: hold the row's height so the CTA doesn't shift in.
  if (signedIn === null) return <span className="block min-h-11" aria-hidden />;

  if (signedIn) {
    return (
      <Link href="/teacher" className={button.primary}>
        Continue to the teacher console
      </Link>
    );
  }

  return <SignInButton next="/teacher" label={label} />;
}
