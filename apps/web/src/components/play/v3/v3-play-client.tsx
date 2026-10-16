"use client";

import type { ReactNode } from "react";
import type { PlayerView } from "@adventure/play-contract";

import { BriefingScreen } from "@/components/play/v3/briefing-screen";
import { EpilogueScreen } from "@/components/play/v3/epilogue-screen";
import { InterviewScreen } from "@/components/play/v3/interview-screen";
import { RevealScreen } from "@/components/play/v3/reveal-screen";
import { StageIntroScreen } from "@/components/play/v3/stage-intro-screen";
import { StagePlayScreen } from "@/components/play/v3/stage-play-screen";
import { useV3Play } from "@/components/play/v3/use-v3-play";
import styles from "@/components/play/adventure-chrome.module.css";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";

export function V3PlayClient({
  attemptId,
  initialView,
  initialRevision,
  portraitBase = null,
  makeClient,
  notice,
  busyLabel = "Saving…",
}: {
  attemptId: string;
  initialView: PlayerView;
  initialRevision: number;
  portraitBase?: string | null;
  makeClient?: () => PlayClient;
  notice?: ReactNode;
  busyLabel?: string;
}) {
  const { view, busy, banner, send, clearBanner } = useV3Play(
    attemptId,
    initialView,
    initialRevision,
    makeClient,
  );

  return (
    <div className={`${styles.shell} min-h-screen`}>
      <header className={`${styles.header} shrink-0`}>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#ead5ae]">Historical adventure</p>
          <h1 className={`${styles.adventureTitle} mt-1 break-words`}>{view.stage?.title ?? view.briefing.name}</h1>
        </div>
        {busy ? <span role="status" className="text-sm font-semibold">{busyLabel}</span> : null}
      </header>
      {notice}
      {banner ? (
        <div role="alert" className="mx-auto mt-4 flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-signal bg-signal-wash px-4 py-3 text-sm font-semibold text-ink">
          <span>{banner.message}</span>
          <button type="button" onClick={clearBanner} className="min-h-9 rounded-lg px-2 underline">Dismiss</button>
        </div>
      ) : null}
      {view.phase === "briefing" ? (
        <BriefingScreen briefing={view.briefing} onContinue={() => { if (!busy) send({ type: "continue" }); }} />
      ) : view.phase === "stage" && view.stage?.intro ? (
        <StageIntroScreen stage={view.stage} onContinue={() => { if (!busy) send({ type: "continue" }); }} />
      ) : view.phase === "stage" ? (
        <StagePlayScreen view={view} busy={busy} send={send} portraitBase={portraitBase} attemptId={attemptId} />
      ) : view.phase === "epilogue" && view.epilogue ? (
        <EpilogueScreen epilogue={view.epilogue} busy={busy} send={send} />
      ) : view.phase === "interview" && view.interview ? (
        <InterviewScreen interview={view.interview} notes={view.notes} busy={busy} send={send} />
      ) : view.phase === "reveal" && view.reveal ? (
        <RevealScreen reveal={view.reveal} />
      ) : (
        <main className="mx-auto grid min-h-[60dvh] max-w-3xl place-items-center px-5 py-12">
          <section className="w-full rounded-3xl border-2 border-ink bg-surface p-8 text-center shadow-[0_5px_0_var(--ink)]">
            <h1 className="text-xl font-black text-ink">This part of the adventure could not be loaded.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">Refresh the page to try again.</p>
          </section>
        </main>
      )}
    </div>
  );
}
