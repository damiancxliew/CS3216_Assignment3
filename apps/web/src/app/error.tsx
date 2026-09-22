"use client";

import Link from "next/link";

import { button, Wordmark } from "@/components/ui";

/** The last resort for a render that threw. Says what to do, not what went wrong inside. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <Wordmark />
      <div className="flex flex-1 flex-col justify-center gap-5 py-16">
        <p className="text-base text-muted">Something broke on our side</p>
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">This page couldn’t load</h1>
        <p className="max-w-[50ch] text-lg text-muted">
          Nothing you did caused it, and nothing was lost: attempts and drafts are saved as you go. Try again, and if it keeps happening, tell your teacher.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={reset} className={button.primary}>
            Try again
          </button>
          <Link href="/" className={button.quiet}>
            Go to the start
          </Link>
        </div>
        {error.digest ? <p className="text-sm text-muted">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}
