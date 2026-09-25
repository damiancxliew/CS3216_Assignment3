import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdventureHeader } from "@/components/play/adventure-header";
import styles from "@/components/play/adventure-chrome.module.css";
import { PlayClient } from "@/components/play/play-client";
import { button } from "@/components/ui";
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
  if (!initial.ok) console.error("Unable to load play state", initial.error);
  const active = initial.ok && initial.state.status === "active" ? initial.state : null;

  return (
    <main className={`${styles.shell} flex h-dvh min-h-0 flex-col`}>
      <AdventureHeader title={resume.adventureTitle} active={active} recap={resume.recap} />

      {initial.ok ? (
        <PlayClient attemptId={attemptId} initialState={initial.state} retriesAllowed={resume.retriesAllowed} />
      ) : (
        <section className="m-6 flex max-w-xl flex-col gap-3 rounded-surface border border-line bg-surface p-6">
          <p className="text-ink">This adventure can’t be opened right now. Try again later or ask your teacher for help.</p>
          {resume.status === "completed" ? (
            <Link href={`/play/${attemptId}/debrief`} className={`${button.quiet} w-fit`}>
              Read your debrief
            </Link>
          ) : null}
        </section>
      )}
    </main>
  );
}
