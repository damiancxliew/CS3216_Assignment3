"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { Suspense, useEffect, type ReactNode } from "react";

import type { AnalyticsEvent } from "./events";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialised = false;

function init() {
  if (initialised || !key || typeof window === "undefined") return;
  posthog.init(key, {
    api_host: host,
    // Pageviews are captured explicitly below: the App Router does not do a
    // full page load on navigation.
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
  });
  initialised = true;
}

function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!key) return;
    const query = searchParams.toString();
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${pathname}${query ? `?${query}` : ""}`,
    });
  }, [pathname, searchParams]);

  return null;
}

export function Analytics({ children }: { children: ReactNode }) {
  init();

  if (!key) return <>{children}</>;

  return (
    <PostHogProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
      {children}
    </PostHogProvider>
  );
}

/** Typed capture so event names stay inside the M19 vocabulary. */
export function track(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
) {
  if (!key || typeof window === "undefined") return;
  posthog.capture(event, properties);
}

export function identify(userId: string, properties?: Record<string, unknown>) {
  if (!key || typeof window === "undefined") return;
  posthog.identify(userId, properties);
}
