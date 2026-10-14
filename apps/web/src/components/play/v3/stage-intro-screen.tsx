"use client";

import type { StageView } from "@adventure/play-contract";

export function StageIntroScreen({ stage, onContinue }: { stage: StageView; onContinue: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-8 sm:py-12">
      <header className="rounded-3xl border-2 border-ink bg-sunshine p-6 shadow-[0_5px_0_var(--ink)] sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-signal">Stage {stage.index + 1} of {stage.count}</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-ink sm:text-5xl">{stage.title}</h1>
        <p className="mt-3 font-bold text-muted">{stage.timePlace}</p>
        <p className="mt-6 text-xl font-bold leading-relaxed text-ink">{stage.centralQuestion}</p>
      </header>
      {stage.intro ? (
        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <p className="whitespace-pre-line text-base leading-8 text-ink">{stage.intro.narration}</p>
          {stage.intro.predictionReveal ? (
            <aside className="mt-6 rounded-xl border-l-4 border-record bg-record-wash p-4">
              <h2 className="font-black text-record">What happened</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink">{stage.intro.predictionReveal.actual}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{stage.intro.predictionReveal.because}</p>
            </aside>
          ) : null}
        </section>
      ) : null}
      <button
        type="button"
        onClick={onContinue}
        className="min-h-12 justify-self-start rounded-xl border-2 border-ink bg-world px-6 py-3 font-black text-white shadow-[0_4px_0_var(--ink)] hover:brightness-110"
      >
        Start exploring
      </button>
    </main>
  );
}
