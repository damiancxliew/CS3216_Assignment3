"use client";

import { useEffect } from "react";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { identify, track } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";

/**
 * Ties the analytics identity to the auth identity, so the M19 funnel can
 * follow one person from the landing page through to a debrief.
 */
export function AuthListener() {
  useEffect(() => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return;
    }

    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session?.user) return;
      identify(session.user.id, { email: session.user.email });
      track(ANALYTICS_EVENTS.signInCompleted, {
        provider: session.user.app_metadata?.provider,
      });
    });

    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
