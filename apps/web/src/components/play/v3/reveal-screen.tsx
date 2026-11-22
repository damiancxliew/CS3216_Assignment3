"use client";

import type { RevealView } from "@adventure/play-contract";
import { Check, GitFork } from "lucide-react";
import { useState, type ReactNode } from "react";

import { pixelFont } from "./pixel-font";
import { PocketPill, PocketTag, pocketStyles } from "./pocket-ui";

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
    <main className={`${pocketStyles.root} mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 text-[#1f2433] sm:px-8 sm:py-12`}>
      <header className={`${pocketStyles.panel} ${pocketStyles.panelRaised} bg-[#fff1c7] p-6 sm:p-9`}>
        <PocketTag>Your story</PocketTag>
        <h2 className={`${pixelFont.className} mt-3 text-3xl font-bold sm:text-5xl`}>What happened</h2>
        <p className="mt-5 whitespace-pre-line text-base leading-8 sm:text-lg">{reveal.whatHappened}</p>
      </header>

      <section aria-labelledby="reveal-timeline" className="grid gap-4">
        <h3 id="reveal-timeline" className={`${pixelFont.className} text-2xl font-bold`}>Your path and history</h3>
        <ol className="relative grid gap-6 border-l-4 border-dashed border-[#1f2433]/30 pl-6 sm:pl-8">
          {reveal.pathVsHistory.map((path) => (
            <li key={path.stageIndex} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -left-[2.45rem] top-4 grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#1f2433] text-sm font-black sm:-left-[2.95rem] ${
                  path.matched ? "bg-[#d7f0e2] text-[#145238]" : "bg-[#ffe1da] text-[#a8442a]"
                }`}
              >
                {path.matched ? <Check size={16} /> : <GitFork size={16} />}
              </span>
              <article className={`${pocketStyles.panel} p-5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className={`${pixelFont.className} text-lg font-bold`}>Stage {path.stageIndex + 1}</h4>
                  <PocketPill tone={path.matched ? "good" : "danger"}>{path.matched ? "Matched history" : "Went differently"}</PocketPill>
                </div>
                {path.act || path.prediction ? (
                  <dl className="mt-4 grid gap-2 text-sm leading-relaxed">
                    {path.act ? (
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 font-black text-muted">You chose</dt>
                        <dd className="text-ink">{path.act}</dd>
                      </div>
                    ) : null}
                    {path.prediction ? (
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 font-black text-muted">You predicted</dt>
                        <dd className="text-ink">
                          {path.prediction.text}{" "}
                          <span className={`ml-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-black ${path.prediction.correct ? "bg-world-wash text-world" : "bg-record-wash text-record"}`}>
                            {path.prediction.correct ? "Right" : "Not quite"}
                          </span>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                <div className={`mt-4 grid gap-3 ${path.matched ? "" : "sm:grid-cols-2"}`}>
                  <div className="rounded-xl border border-line bg-paper p-3">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">{path.matched ? "In your story and in history" : "In your story"}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{path.yours}</p>
                  </div>
                  {path.matched ? null : (
                    <div className="rounded-xl border border-line bg-record-wash p-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-record">In history</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{path.history}</p>
                    </div>
                  )}
                </div>
                {path.closedEndings.length ? (
                  <p className="mt-3 text-sm font-semibold text-record">
                    This closed off: {path.closedEndings.join(", ")}
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className={`${pocketStyles.panel} p-5`}>
          <h3 className={`${pixelFont.className} text-xl font-bold`}>Corrections</h3>
          <TextList items={reveal.corrections} />
        </article>
        <article className={`${pocketStyles.panel} p-5`}>
          <h3 className={`${pixelFont.className} text-xl font-bold`}>Core ideas you missed</h3>
          <TextList items={reveal.missedCore} />
        </article>
      </section>

      <button
        type="button"
        aria-expanded={showMore}
        onClick={() => setShowMore((open) => !open)}
        className={`${pixelFont.className} min-h-12 justify-self-start rounded-lg border-[3px] border-[#1f2433] bg-[#fffaf0] px-5 py-3 text-lg font-bold shadow-[0_4px_0_#1f2433] hover:bg-[#ffe58a]`}
      >
        {showMore ? "Show less" : "Show more"}
      </button>

      {showMore ? (
        <section className={`${pocketStyles.panel} grid gap-5 p-5 sm:p-7`}>
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
        <section className={`${pocketStyles.panel} bg-[#d7f0e2] p-5 sm:p-7`}>
          <h3 className={`${pixelFont.className} text-xl font-bold text-[#145238]`}>Questions from your teacher</h3>
          <TextList items={reveal.teacherQuestions} />
        </section>
      ) : null}

      <footer className="mt-3 grid justify-items-center gap-3 border-t-4 border-dashed border-[#1f2433]/25 pt-6 text-center">
        {footer ?? (
          <p className={`${pixelFont.className} text-lg font-bold`}>
            You&apos;ve finished this adventure. You can close this tab.
          </p>
        )}
      </footer>
    </main>
  );
}
