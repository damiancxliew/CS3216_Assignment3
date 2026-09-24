import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ThemeSelect } from "@/components/theme-provider";
import { DebriefViewed } from "@/components/debrief-viewed";
import { button, RecordEntry, WorldEntry, Wordmark } from "@/components/ui";
import { loadDebrief } from "@/lib/attempts/debrief";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Debrief",
  robots: { index: false },
};

/**
 * P8/FR-19. The separation is structural, not decorative: documented history
 * and its citations render in the record register (serif, ink-blue, always
 * with provenance), the simulation's own inventions in the world register
 * (sans, moss), and neither can borrow the other's styling because they
 * arrive as separately-typed fields from `loadDebrief`.
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-14 px-6 py-8 sm:py-10">
      <DebriefViewed endingId={debrief.ending.id} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-3">
          <ThemeSelect />
          <Link href={`/play/${debrief.attemptId}`} className={button.quiet}>
            Back to your attempt
          </Link>
          <Link href="/" className={button.subtle}>
            Leave for the home page
          </Link>
        </div>
      </div>

      <header className="flex flex-col gap-3">
        <p className="text-base text-muted">{debrief.adventureTitle}. Your debrief.</p>
        <h1 className="text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">{debrief.ending.title}</h1>
        <p className="max-w-[60ch] pt-2 text-base text-muted">
          Blue shows what the sources say, with page references. Green shows what happened in the simulation.
        </p>
      </header>

      <Part title="In your simulation" register="world">
        {debrief.path.length === 0 ? (
          <p className="text-base text-muted">No stage decisions were recorded for this attempt.</p>
        ) : (
          <ol className="flex flex-col gap-6">
            {debrief.path.map((stage) => (
              <li key={stage.stageIndex}>
                <WorldEntry label={`Stage ${stage.stageIndex + 1}: ${stage.stageTitle}`}>
                  <p>
                    <span className="text-muted">You chose </span>
                    {stage.chose ?? "nothing. The clock ran out and the stage went the way it would have without you."}
                  </p>
                  {stage.announcement ? <p className="mt-2">{stage.announcement}</p> : null}
                  {stage.changes.length ? (
                    <ul className="mt-2 list-disc pl-5 text-base text-muted">
                      {stage.changes.map((change, i) => (
                        <li key={i}>{change}</li>
                      ))}
                    </ul>
                  ) : null}
                </WorldEntry>
              </li>
            ))}
          </ol>
        )}
        <WorldEntry label="How it ended in the game">
          <p>{debrief.simulatedOutcome}</p>
          <p className="mt-2 text-base text-muted">Simulation outcomes are fictional.</p>
        </WorldEntry>
      </Part>

      <Part title="What the record says" register="record">
        <p className="max-w-[62ch] font-serif text-xl leading-[1.6] text-ink">{debrief.documentedHistory.text}</p>
        {debrief.documentedHistory.citations.length === 0 ? (
          <p className="max-w-[60ch] text-base text-muted">
            No page citations are available for this ending. Treat the paragraph above as a summary, not a source.
          </p>
        ) : (
          <ol className="flex flex-col gap-6">
            {debrief.documentedHistory.citations.map((citation, index) => (
              <li key={`${citation.sourceId}-${citation.page}-${index}`}>
                <RecordEntry
                  quote={citation.quote}
                  source={
                    <>
                      {citation.sourceTitle} ({citation.sourceKind}), page {citation.page}
                    </>
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </Part>

      <Part title="Where the record is silent, the simulation assumed" register="world">
        {debrief.assumptions.length === 0 ? (
          <p className="max-w-[60ch] text-base text-muted">
            No assumptions are listed for this attempt.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {debrief.assumptions.map((assumption) => (
              <li key={assumption.id}>
                <WorldEntry>
                  <p>{assumption.text}</p>
                  <p className="mt-1.5 text-base text-muted">{assumption.rationale}</p>
                </WorldEntry>
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part title="Where your story left history behind">
        <p className="max-w-[62ch] text-lg leading-relaxed text-ink">{debrief.divergence}</p>
      </Part>

      <Part title="To think about">
        <p className="max-w-[60ch] text-base text-muted">Use a detail from your collected evidence to explain your decision. Compare it with what happened in history, and consider whose perspective might change your judgement.</p>
        <ol className="flex flex-col gap-4">
          {debrief.reflectionQuestions.map((question, index) => (
            <li key={question} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span className="font-serif text-2xl leading-none text-muted" aria-hidden>
                {index + 1}
              </span>
              <p className="max-w-[58ch] text-lg leading-relaxed text-ink">{question}</p>
            </li>
          ))}
        </ol>
      </Part>

      <Part title="Your collected evidence">
        {debrief.collectedEvidence.length ? (
          <div className="flex flex-col gap-3">
            {debrief.collectedEvidence.map((entry) => (
              <details key={entry.id} className="rounded-surface border border-line bg-surface p-4">
                <summary className="cursor-pointer text-lg font-semibold text-ink">{entry.name}</summary>
                {entry.stageTitle ? <p className="mt-3 text-sm text-muted">Collected in {entry.stageTitle}</p> : null}
                <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">{entry.text}</p>
                {entry.sourceSpan ? (
                  <div className="mt-4 border-t border-line pt-3">
                    <p className="text-sm font-semibold text-record">Supporting source excerpts</p>
                    <p className="mt-2 whitespace-pre-line font-serif text-base leading-relaxed text-record">{entry.sourceSpan}</p>
                  </div>
                ) : null}
              </details>
            ))}
          </div>
        ) : <p className="text-base text-muted">You did not collect any scrolls. Use the cited historical record above to reflect on what information you were missing.</p>}
      </Part>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line pt-8">
        <Link href={`/play/${debrief.attemptId}`} className={button.quiet}>
          Back to your attempt
        </Link>
        <Link href="/" className={button.subtle}>
          Leave for the home page
        </Link>
      </footer>
    </main>
  );
}

/** One part of the debrief. The heading takes the register's colour so the page can be scanned by colour alone. */
function Part({
  title,
  register,
  children,
}: {
  title: string;
  register?: "record" | "world";
  children: React.ReactNode;
}) {
  const tone = register === "record" ? "text-record" : register === "world" ? "text-world" : "text-ink";
  return (
    <section className="flex flex-col gap-6 border-t border-line pt-8">
      <h2 className={`text-2xl font-extrabold tracking-tight ${tone}`}>{title}</h2>
      {children}
    </section>
  );
}
