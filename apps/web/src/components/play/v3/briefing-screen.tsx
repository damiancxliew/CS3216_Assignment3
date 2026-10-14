"use client";

import type { RoleBriefingView } from "@adventure/play-contract";

export function BriefingScreen({ briefing, onContinue }: { briefing: RoleBriefingView; onContinue: () => void }) {
  const lists = [
    ["Your goals", briefing.privateBrief.goals],
    ["Your fears", briefing.privateBrief.fears],
    ["Your constraints", briefing.privateBrief.constraints],
    ["What you know", briefing.privateBrief.knows],
  ] as const;

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="rounded-3xl border-2 border-ink bg-record-wash p-6 shadow-[0_5px_0_var(--ink)] sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-record">Your role</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-ink sm:text-5xl">{briefing.name}</h1>
        <p className="mt-2 text-lg font-semibold text-muted">{briefing.position}</p>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-ink">{briefing.situation}</p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-black text-ink">Your relationships</h2>
          <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-muted">
            {briefing.relationships.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>
        <article className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-black text-ink">Your reputation</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{briefing.reputation}</p>
          <h3 className="mt-5 text-sm font-black uppercase tracking-wide text-signal">What is at stake</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{briefing.stakes}</p>
        </article>
        {lists.map(([title, items]) => (
          <article key={title} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-black text-ink">{title}</h2>
            <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-muted">
              {items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </article>
        ))}
      </section>
      <button
        type="button"
        onClick={onContinue}
        className="min-h-12 justify-self-start rounded-xl border-2 border-ink bg-world px-6 py-3 font-black text-white shadow-[0_4px_0_var(--ink)] hover:brightness-110"
      >
        Enter the first stage
      </button>
    </main>
  );
}
