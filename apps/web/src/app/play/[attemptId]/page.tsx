import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { StageCountdown } from "@/components/stage-countdown";
import { loadResumeState } from "@/lib/attempts/resume";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your attempt",
  robots: { index: false },
};

/**
 * The student's attempt. The game view itself lands with the renderer (Yi
 * Hao's slice); what this page owns is P7 — everything needed to pick up where
 * you left off is read back from the server, so admission is provably enforced
 * (RLS returns nothing for someone else's attempt and the page 404s) and a
 * killed tab costs nothing but the recap you get on the way back in.
 */
export default async function PlayPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const state = await loadResumeState(supabase, attemptId);
  if (!state) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-20">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-widest opacity-60">
          {state.status === "completed" ? "Finished" : "Welcome back"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {state.adventureTitle}
        </h1>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Where you left off
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {state.recap.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {state.stage ? (
          <p className="text-sm opacity-80">{state.stage.sharedContext}</p>
        ) : null}
        <p className="text-sm">
          <span className="opacity-60">Time left: </span>
          <StageCountdown
            attemptId={state.attemptId}
            deadlineIso={state.timer.deadlineAt}
            serverNowIso={state.timer.serverNow}
          />
        </p>
      </section>

      {state.journal.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
            Journal
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {state.journal.map((entry) => (
              <li
                key={entry.id}
                className="rounded border border-black/10 p-3 dark:border-white/15"
              >
                <p>{entry.text}</p>
                {entry.sourceSpan ? (
                  <p className="mt-1 text-xs opacity-60">{entry.sourceSpan}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.transcript.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
            Transcript
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {state.transcript.map((message) => (
              <li key={message.id}>
                <span className="opacity-60">{message.authorType}: </span>
                {message.body}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs opacity-60">
        The playable view arrives with the renderer; this state is read from the
        server on every visit, so nothing here depends on the tab staying open.
      </p>
    </main>
  );
}
