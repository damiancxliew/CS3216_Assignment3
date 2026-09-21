"use client";

import { useEffect } from "react";

import { SignInButton } from "@/components/sign-in-button";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";

export default function Home() {
  useEffect(() => {
    track(ANALYTICS_EVENTS.landingViewed);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-24">
      <div className="flex flex-col gap-4">
        <p className="text-sm uppercase tracking-widest opacity-60">
          CS3216 Assignment 3
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Play the source material.
        </h1>
        <p className="text-lg opacity-80">
          A teacher drops in historical sources. The system builds a small world
          around them, fills it with people who each want something different,
          and lets a student find out what their decisions cost.
        </p>
      </div>
      <SignInButton next="/" label="Teacher sign-in with Google" />
      <div className="flex flex-col gap-2 text-sm opacity-70">
        <p>The teacher console and the game client land this week.</p>
        <p>
          API contract in progress:{" "}
          <code className="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">
            GET /api/attempt/:id/state
          </code>
        </p>
      </div>
    </main>
  );
}
