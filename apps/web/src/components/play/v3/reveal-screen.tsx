"use client";

import type { RevealView } from "@adventure/play-contract";
import { useState, type ReactNode } from "react";

function TextList({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-ink">
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  ) : <p className="mt-3 text-sm text-muted">Nothing to add here.</p>;
}

function SourceGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-line bg-paper p-4">
      <h4 className="font-black text-ink">{title}</h4>
      <TextList items={items} />
    </section>
  );
}

export function RevealScreen({ reveal, footer }: { reveal: RevealView; footer?: ReactNode }) {
  const [showMore, setShowMore] = useState(false);

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-8 sm:px-8 sm:py-12">
      <header className="rounded-3xl border-2 border-ink bg-sunshine p-6 shadow-[0_5px_0_var(--ink)] sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-record">Your story</p>
        <h2 className="mt-2 text-3xl font-black text-ink sm:text-4xl">What happened</h2>
        <p className="mt-5 whitespace-pre-line text-base leading-8 text-ink">{reveal.whatHappened}</p>
      </header>

      <section className="grid gap-4">
        <h3 className="text-xl font-black text-ink">Your path and history</h3>
        {reveal.pathVsHistory.map((path) => (
          <article key={path.stageIndex} className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-black text-ink">Stage {path.stageIndex + 1}</h4>
              {path.matched ? <span className="rounded-full bg-world-wash px-3 py-1 text-xs font-black text-world">✓ Matched history</span> : null}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink"><strong>Your path:</strong> {path.yours}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted"><strong>History:</strong> {path.history}</p>
            {path.closedEndings.length ? (
              <p className="mt-3 rounded-lg bg-record-wash px-3 py-2 text-sm font-semibold text-record">
                This closed: {path.closedEndings.join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="text-lg font-black text-ink">Corrections</h3>
          <TextList items={reveal.corrections} />
        </article>
        <article className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="text-lg font-black text-ink">Core ideas you missed</h3>
          <TextList items={reveal.missedCore} />
        </article>
      </section>

      <button
        type="button"
        aria-expanded={showMore}
        onClick={() => setShowMore((open) => !open)}
        className="min-h-12 justify-self-start rounded-xl border-2 border-ink bg-surface px-5 py-3 font-black text-ink shadow-[0_3px_0_var(--ink)] hover:bg-world-wash"
      >
        {showMore ? "Show less" : "Show more"}
      </button>

      {showMore ? (
        <section className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <section>
            <h3 className="text-lg font-black text-ink">Different interpretations</h3>
            <TextList items={reveal.more.interpretations} />
          </section>
          <section className="grid gap-3">
            <h3 className="text-lg font-black text-ink">Sources</h3>
            <SourceGroup title="From your teacher" items={reveal.more.sources.teacher} />
            <SourceGroup title="Other sources" items={reveal.more.sources.other} />
            <SourceGroup title="Invented for the game" items={reveal.more.sources.invented} />
          </section>
          <section>
            <h3 className="text-lg font-black text-ink">What could have gone differently</h3>
            <TextList items={reveal.more.couldHaveGone} />
          </section>
          {reveal.more.secretPathExisted ? (
            <p className="rounded-xl border-l-4 border-signal bg-signal-wash p-4 font-semibold leading-relaxed text-ink">
              There was also a hidden path through this story.
            </p>
          ) : null}
          <section className="grid gap-4">
            <h3 className="text-lg font-black text-ink">Your choices</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-line bg-paper p-4">
                <h4 className="font-black text-ink">Acts</h4>
                <TextList items={reveal.more.playback.acts} />
              </article>
              <article className="rounded-xl border border-line bg-paper p-4">
                <h4 className="font-black text-ink">Predictions</h4>
                <TextList items={reveal.more.playback.predictions} />
              </article>
              <article className="rounded-xl border border-line bg-paper p-4">
                <h4 className="font-black text-ink">Interview answers</h4>
                <TextList items={reveal.more.playback.interview} />
              </article>
            </div>
          </section>
        </section>
      ) : null}

      {reveal.teacherQuestions.length ? (
        <section className="rounded-2xl border-2 border-world bg-world-wash p-5 sm:p-7">
          <h3 className="text-lg font-black text-world">Questions from your teacher</h3>
          <TextList items={reveal.teacherQuestions} />
        </section>
      ) : null}

      <footer className="mt-3 grid justify-items-center gap-3 border-t border-line pt-6 text-center">
        {footer ?? (
          <p className="text-base font-semibold text-ink">
            You&apos;ve finished this adventure. You can close this tab.
          </p>
        )}
      </footer>
    </main>
  );
}
