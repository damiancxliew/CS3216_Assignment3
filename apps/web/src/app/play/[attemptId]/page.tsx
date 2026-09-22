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
 * The student's attempt: the recap (P7) on top, the playable view under it.
 * The first state is read on the server so the page renders with the world in
 * it; from then on the client talks to the Turn API (I3), which owns every
 * change. Admission is enforced twice over — RLS returns nothing for someone
 * else's attempt (the page 404s), and the Turn API checks the student again.
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

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-widest opacity-60">
          {resume.status === "completed" ? "Finished" : initial.ok && initial.state.revision === 0 ? "Welcome" : "Welcome back"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{resume.adventureTitle}</h1>
        {initial.ok && initial.state.status === "active" ? (
          <p className="max-w-3xl text-sm opacity-80">
            <span className="font-medium">
              Stage {initial.state.stage.index + 1} of {initial.state.stageCount}: {initial.state.stage.title}.
            </span>{" "}
            {initial.state.stage.sharedContext}
          </p>
        ) : null}
        {resume.recap.length && initial.ok && initial.state.revision > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm opacity-70">
            {resume.recap.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </header>

      {initial.ok ? (
        <PlayClient attemptId={attemptId} initialState={initial.state} />
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-5 text-sm dark:border-white/15">
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
