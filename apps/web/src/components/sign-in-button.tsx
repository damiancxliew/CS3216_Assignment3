"use client";

import { useState } from "react";

import { DevSignIn } from "@/components/dev-sign-in";
import { button, Pending } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";

export function SignInButton({
  next = "/",
  label = "Continue with Google",
  variant = "primary",
}: {
  next?: string;
  label?: string;
  variant?: "primary" | "quiet";
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
    <div className="flex flex-col gap-3">
      <button type="button" onClick={signIn} disabled={pending} className={`${button[variant]} w-fit`}>
        {pending ? <Pending>Taking you to Google…</Pending> : label}
      </button>
      <DevSignIn next={next} />
    </div>
  );
}
