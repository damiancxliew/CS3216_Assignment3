import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PlayClient } from "@/components/play/play-client";
import { button, Mark } from "@/components/ui";
import { loadResumeState } from "@/lib/attempts/resume";
import { playDeps } from "@/lib/play/http";
import { getState } from "@/lib/play/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your attempt",
  robots: { index: false },
};

// Opening the page may settle an expired stage, which is one resolver call.
export const maxDuration = 60;

/**
 * The student's attempt: the map fills the screen, the panel does everything
 * the map does without it. The first state is read on the server so the page
 * renders with the world in it; from then on the client talks to the Turn API
 * (I3), which owns every change. Admission is enforced twice over — RLS returns
 * nothing for someone else's attempt (the page 404s), and the Turn API checks
 * the student again.
 */
export default async function PlayPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const resume = await loadResumeState(supabase, attemptId);
  if (!resume) notFound();

  const initial = await getState(playDeps(), attemptId, user.id);
  const active = initial.ok && initial.state.status === "active" ? initial.state : null;

  return (
    <main className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex flex-col items-start gap-x-6 gap-y-2 border-b border-line bg-surface px-5 py-3 lg:flex-row lg:items-baseline">
        <h1 className="inline-flex max-w-full break-words items-center gap-2.5 font-serif text-xl text-ink">
          <Mark />
          {resume.adventureTitle}
        </h1>
        {active ? (
          <details className="group w-full min-w-0 text-base lg:w-auto lg:flex-1">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 text-ink marker:content-none">
              <span className="font-semibold">
                Stage {active.stage.index + 1} of {active.stageCount}: {active.stage.title}
              </span>
              <span className="text-base text-muted underline decoration-line-strong underline-offset-4 group-hover:text-ink">
                <span className="group-open:hidden">What is going on?</span>
                <span className="hidden group-open:inline">Hide</span>
              </span>
            </summary>
            <div className="mt-3 flex max-w-[64ch] flex-col gap-3 pb-1 text-lg leading-relaxed text-ink">
              <p>{active.stage.sharedContext}</p>
              {resume.recap.length && active.revision > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-6 text-base text-muted">
                  {resume.recap.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
      </header>

      {initial.ok ? (
        <PlayClient attemptId={attemptId} initialState={initial.state} />
      ) : (
        <section className="m-6 flex max-w-xl flex-col gap-3 rounded-surface border border-line bg-surface p-6">
          <p className="text-ink">This attempt cannot be played right now: {initial.error.message}</p>
          {resume.status === "completed" ? (
            <Link href={`/play/${attemptId}/debrief`} className={`${button.link} w-fit`}>
              Read your debrief
            </Link>
          ) : null}
        </section>
      )}
    </main>
  );
}
