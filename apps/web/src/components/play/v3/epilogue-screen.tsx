"use client";

import type { Action, PlayerView } from "@adventure/play-contract";

export function EpilogueScreen({
  epilogue,
  busy,
  send,
}: {
  epilogue: NonNullable<PlayerView["epilogue"]>;
  busy: boolean;
  send: (action: Action) => void;
}) {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-8 sm:py-12">
      <article className="rounded-3xl border-2 border-ink bg-sunshine p-6 shadow-[0_5px_0_var(--ink)] sm:p-10">
        <span className="inline-flex rounded-full bg-surface px-3 py-1 text-xs font-black uppercase tracking-wide text-record">
          {epilogue.label}
        </span>
        <h2 className="mt-5 text-3xl font-black leading-tight text-ink sm:text-5xl">{epilogue.title}</h2>
        <p className="mt-6 whitespace-pre-line text-base leading-8 text-ink sm:text-lg">{epilogue.text}</p>
      </article>
      <button
        type="button"
        disabled={busy}
        onClick={() => send({ type: "continue" })}
        className="min-h-12 justify-self-start rounded-xl border-2 border-ink bg-world px-6 py-3 font-black text-white shadow-[0_4px_0_var(--ink)] hover:brightness-110 disabled:opacity-50"
      >
        Continue
      </button>
    </main>
  );
}
