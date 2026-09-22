"use client";

import { useEffect } from "react";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";

/** Closes the M19 funnel: landing → sign-in → publish → play → debrief. */
export function DebriefViewed({ endingId }: { endingId: string }) {
  useEffect(() => {
    track(ANALYTICS_EVENTS.debriefViewed, { endingId });
  }, [endingId]);

  return null;
}
