"use client";

import { useState } from "react";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";

export function SignInButton({
  next = "/",
  label = "Continue with Google",
}: {
  next?: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    track(ANALYTICS_EVENTS.signInStarted, { next });

    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });

    if (error) setPending(false);
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className="inline-flex w-fit items-center gap-2 rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
    >
      {pending ? "Redirecting…" : label}
    </button>
  );
}
