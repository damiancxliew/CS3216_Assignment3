import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DebriefViewed } from "@/components/debrief-viewed";
import { loadDebrief } from "@/lib/attempts/debrief";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Debrief",
  robots: { index: false },
};

/**
 * P8/FR-19. The separation is structural, not decorative: documented history
 * and its citations render in one panel, the simulation's own inventions in a
 * visually distinct one, and neither can borrow the other's styling because
 * they arrive as separately-typed fields from `loadDebrief`.
 */
export default async function DebriefPage({
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

  const debrief = await loadDebrief(supabase, attemptId);
  if (!debrief) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-20">
      <DebriefViewed endingId={debrief.ending.id} />

      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-widest opacity-60">
          {debrief.adventureTitle} — debrief
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {debrief.ending.title}
        </h1>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-amber-500/60 bg-amber-500/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          In your simulation
        </h2>
        {debrief.path.length ? (
          <ol className="flex flex-col gap-3 text-sm">
            {debrief.path.map((stage) => (
              <li key={stage.stageIndex} className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-wide opacity-60">
                  Stage {stage.stageIndex + 1}: {stage.stageTitle}
                </p>
                <p>
                  <span className="opacity-70">You chose: </span>
                  {stage.chose ?? "nothing — the clock ran out and the stage went the way it would have without you"}
                </p>
                {stage.announcement ? <p className="opacity-90">{stage.announcement}</p> : null}
                {stage.changes.length ? (
                  <ul className="list-disc pl-5 text-xs opacity-70">
                    {stage.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        <p className="text-sm">{debrief.simulatedOutcome}</p>
        <p className="text-xs opacity-70">
          This is what happened in the game, not a historical claim.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border-2 border-emerald-700/60 bg-emerald-600/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
          What the record says
        </h2>
        <p className="text-sm">{debrief.documentedHistory.text}</p>
        {debrief.documentedHistory.citations.length ? (
          <ol className="flex flex-col gap-2 text-sm">
            {debrief.documentedHistory.citations.map((citation, index) => (
              <li
                key={`${citation.sourceId}-${citation.page}-${index}`}
                className="border-l-2 border-emerald-700/40 pl-3"
              >
                <p className="italic">“{citation.quote}”</p>
                <p className="text-xs opacity-70">
                  {citation.sourceTitle} ({citation.sourceKind}), p.
                  {citation.page}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {debrief.assumptions.length ? (
        <section className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-amber-500/60 bg-amber-500/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Where the record is silent, the simulation assumed
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {debrief.assumptions.map((assumption) => (
              <li key={assumption.id}>
                <p>{assumption.text}</p>
                <p className="text-xs opacity-70">{assumption.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Where your story diverged
        </h2>
        <p className="text-sm">{debrief.divergence}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          To think about
        </h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {debrief.reflectionQuestions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      </section>

      <Link
        href={`/play/${debrief.attemptId}`}
        className="text-sm underline underline-offset-4 opacity-70"
      >
        Back to your attempt
      </Link>
    </main>
  );
}
