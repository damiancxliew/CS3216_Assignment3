"use client";

import Link from "next/link";
import { useEffect } from "react";

import { SiteNavigation } from "@/components/site-navigation";
import { ThemeSelect } from "@/components/theme-provider";
import { button, Wordmark } from "@/components/ui";

/** The last resort for a render that threw. Says what to do, not what went wrong inside. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page failed to load:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-2"><SiteNavigation /><ThemeSelect /></div>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-5 py-16">
        <h1 className="text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">This page couldn’t load</h1>
        <p className="max-w-[50ch] text-lg text-muted">
          Try again. If the problem continues, ask for help.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={reset} className={button.primary}>
            Try again
          </button>
          <Link href="/" className={button.quiet}>
            Go to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
