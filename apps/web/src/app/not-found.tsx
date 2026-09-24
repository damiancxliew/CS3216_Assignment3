import Link from "next/link";

import { ThemeSelect } from "@/components/theme-provider";
import { button, Wordmark } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <ThemeSelect />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-5 py-16">
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">This page doesn’t exist</h1>
        <p className="max-w-[50ch] text-lg text-muted">
          Ask your teacher for the latest link.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/" className={button.primary}>
            Go to the start
          </Link>
          <Link href="/teacher" className={button.quiet}>
            Teacher console
          </Link>
        </div>
      </div>
    </main>
  );
}
