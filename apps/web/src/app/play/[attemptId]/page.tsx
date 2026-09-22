import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PlayClient } from "@/components/play/play-client";
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
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-black/10 px-5 py-3 dark:border-white/15">
        <h1 className="text-lg font-semibold tracking-tight">{resume.adventureTitle}</h1>
        {active ? (
          <details className="min-w-0 flex-1 text-sm">
            <summary className="cursor-pointer opacity-70">
              Stage {active.stage.index + 1} of {active.stageCount}: {active.stage.title}
              <span className="ml-2 text-xs opacity-60">(brief)</span>
            </summary>
            <div className="mt-2 flex max-w-3xl flex-col gap-2 pb-1">
              <p className="opacity-80">{active.stage.sharedContext}</p>
              {resume.recap.length && active.revision > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-xs opacity-60">
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
        <section className="m-6 flex flex-col gap-3 rounded-lg border border-black/10 p-5 text-sm dark:border-white/15">
          <p>This attempt cannot be played right now: {initial.error.message}</p>
          {resume.status === "completed" ? (
            <Link href={`/play/${attemptId}/debrief`} className="w-fit underline underline-offset-4">
              Read your debrief
            </Link>
          ) : null}
        </section>
      )}
    </main>
  );
}
