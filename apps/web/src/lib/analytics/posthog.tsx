"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { Suspense, useEffect, type ReactNode } from "react";

import type { AnalyticsEvent } from "./events";
import { analyticsEnvironment, stagingReplayConfig } from "./environment";
import type { DemoEvent } from "@/lib/demo/analytics-events";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialised = false;

function init() {
  if (initialised || !key || typeof window === "undefined") return;
  const environment = analyticsEnvironment(window.location.hostname, process.env.NEXT_PUBLIC_APP_ENV);
  posthog.init(key, {
    api_host: host,
    // Pageviews are captured explicitly below: the App Router does not do a
    // full page load on navigation.
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
    ...(environment === "staging" ? {
      persistence_name: "pocket-adventures-staging",
      cross_subdomain_cookie: false,
      enable_recording_console_log: false,
    } : {}),
    ...stagingReplayConfig(environment, window.location.pathname),
    loaded: (client) => client.register({ environment }),
    before_send: (event) => {
      if (event) event.properties.environment = environment;
      return event;
    },
  });
  posthog.register({ environment });
  initialised = true;
}

function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!key) return;
    posthog.set_config(stagingReplayConfig(
      analyticsEnvironment(window.location.hostname, process.env.NEXT_PUBLIC_APP_ENV), pathname,
    ));
    const query = searchParams.toString();
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${pathname}${query ? `?${query}` : ""}`,
    });
  }, [pathname, searchParams]);

  return null;
}

/** Standalone-demo instrumentation is enabled only in the staging build/site. */
export function trackDemo({ event, properties }: DemoEvent) {
  if (!key || typeof window === "undefined" ||
      analyticsEnvironment(window.location.hostname, process.env.NEXT_PUBLIC_APP_ENV) !== "staging") return;
  try {
    init();
    posthog.capture(event, properties);
  } catch {
    // Progress remains available when analytics is blocked or unavailable.
  }
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
