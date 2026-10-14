"use client";

import type { PlayerView } from "@adventure/play-contract";

import { BriefingScreen } from "@/components/play/v3/briefing-screen";
import { StageIntroScreen } from "@/components/play/v3/stage-intro-screen";
import { StagePlayScreen } from "@/components/play/v3/stage-play-screen";
import { useV3Play } from "@/components/play/v3/use-v3-play";

export function V3PlayClient({
  attemptId,
  initialView,
  initialRevision,
}: {
  attemptId: string;
  initialView: PlayerView;
  initialRevision: number;
}) {
  const { view, revision, busy, banner, send, clearBanner } = useV3Play(attemptId, initialView, initialRevision);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-ink bg-wood px-4 py-4 text-white sm:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">Historical adventure</p>
          <p className="text-xl font-black">{view.stage?.title ?? view.briefing.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/30 px-3 py-1 text-xs font-bold">Revision {revision}</span>
          {busy ? <span role="status" className="text-sm font-semibold">Saving…</span> : null}
        </div>
      </header>
      {banner ? (
        <div role="alert" className="mx-auto mt-4 flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-signal bg-signal-wash px-4 py-3 text-sm font-semibold text-ink">
          <span>{banner.message}</span>
          <button type="button" onClick={clearBanner} className="min-h-9 rounded-lg px-2 underline">Dismiss</button>
        </div>
      ) : null}
      {view.phase === "briefing" ? (
        <BriefingScreen briefing={view.briefing} onContinue={() => send({ type: "continue" })} />
      ) : view.phase === "stage" && view.stage?.intro ? (
        <StageIntroScreen stage={view.stage} onContinue={() => send({ type: "continue" })} />
      ) : view.phase === "stage" ? (
        <StagePlayScreen view={view} busy={busy} send={send} />
      ) : (
        <main className="mx-auto grid min-h-[60dvh] max-w-3xl place-items-center px-5 py-12">
          <section className="w-full rounded-3xl border-2 border-ink bg-surface p-8 text-center shadow-[0_5px_0_var(--ink)]">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-record">Checkpoint 2</p>
            <h1 className="mt-3 text-3xl font-black text-ink">The next part of your adventure is coming soon.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">Your choices and notes are saved.</p>
          </section>
        </main>
      )}
    </div>
  );
}
