"use client";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import { Compass } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { PlayerView } from "@adventure/play-contract";

import { BriefingScreen } from "@/components/play/v3/briefing-screen";
import { EpilogueScreen } from "@/components/play/v3/epilogue-screen";
import { InterviewScreen } from "@/components/play/v3/interview-screen";
import { MapBackdrop } from "@/components/play/v3/map-backdrop";
import { RevealScreen } from "@/components/play/v3/reveal-screen";
import { StageIntroScreen } from "@/components/play/v3/stage-intro-screen";
import { StagePlayScreen } from "@/components/play/v3/stage-play-screen";
import { useV3Play } from "@/components/play/v3/use-v3-play";
import styles from "@/components/play/adventure-chrome.module.css";
import { backdropFromView, type V3MapBackdrop } from "@/lib/play/v3/backdrop";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";

export function V3PlayClient({
  attemptId,
  scenery = [],
  initialView,
  initialRevision,
  portraitBase = null,
  backdrop = null,
  makeClient,
  headerActions,
  revealFooter,
  busyLabel = "Saving…",
}: {
  attemptId: string;
  scenery?: V3StageScenery[];
  initialView: PlayerView;
  initialRevision: number;
  portraitBase?: PortraitBase;
  backdrop?: V3MapBackdrop | null;
  makeClient?: () => PlayClient;
  headerActions?: ReactNode;
  revealFooter?: ReactNode;
  busyLabel?: string;
}) {
  const { view, busy, banner, send, clearBanner } = useV3Play(
    attemptId,
    initialView,
    initialRevision,
    makeClient,
  );
  const stageMap = backdropFromView(view);
  const [lastMap, setLastMap] = useState(backdrop);
  if (
    stageMap &&
    (lastMap?.rooms !== stageMap.rooms || lastMap.characters !== stageMap.characters || lastMap.currentRoomId !== stageMap.currentRoomId)
  ) {
    setLastMap(stageMap);
  }

  const bannerAlert = banner ? (
    <div role="alert" className="mx-auto mt-4 flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-signal bg-signal-wash px-4 py-3 text-sm font-semibold text-ink">
      <span>{banner.message}</span>
      <button type="button" onClick={clearBanner} className="min-h-9 rounded-lg px-2 underline">Dismiss</button>
    </div>
  ) : null;
  const titleBlock = (
    <h1 className={styles.adventureTitle}>
      <span className={styles.headerEmblem}><Compass size={24} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate">{view.briefing.name}</span>
        <span className="hidden truncate text-xs font-normal text-[#ead5ae] sm:block">Historical adventure · {view.briefing.position}</span>
      </span>
    </h1>
  );
  const headerActionGroup = busy || headerActions ? (
    <div className={styles.headerActions}>
      {busy ? <span role="status" className="text-sm font-semibold">{busyLabel}</span> : null}
      {headerActions}
    </div>
  ) : null;
  const endScreen =
    view.phase === "epilogue" && view.epilogue
      ? { label: "Epilogue", screen: <EpilogueScreen epilogue={view.epilogue} busy={busy} send={send} /> }
      : view.phase === "interview" && view.interview
        ? { label: "The Interview", screen: <InterviewScreen interview={view.interview} notes={view.notes} busy={busy} send={send} /> }
        : null;

  if (endScreen) {
    return (
      <div className={`${styles.shell} flex h-dvh min-h-0 flex-col`}>
        <header className={`${styles.header} shrink-0 lg:[zoom:0.75]`}>
          {titleBlock}
          <div className={`${styles.chapter} flex min-w-0 items-center gap-3`}>
            <span className={styles.chapterNumber}>{endScreen.label}</span>
          </div>
          {headerActionGroup}
        </header>
        {bannerAlert}
        <MapBackdrop attemptId={attemptId} backdrop={lastMap} scenery={scenery[lastMap?.stageIndex ?? 0]}>
          {endScreen.screen}
        </MapBackdrop>
      </div>
    );
  }

  if (view.phase === "stage" && view.stage && view.stage.intro === null) {
    return (
      <div className={`${styles.shell} flex h-dvh min-h-0 flex-col`}>
        <header className={`${styles.header} shrink-0 lg:[zoom:0.75]`}>
          {titleBlock}
          <div className={`${styles.chapter} flex min-w-0 items-center gap-3`}>
            <span className={styles.chapterNumber}>Stage {view.stage.index + 1} of {view.stage.count}</span>
            <span className={`${styles.chapterTitle} min-w-0 truncate`} title={view.stage.title}>{view.stage.title}</span>
          </div>
          {headerActionGroup}
        </header>
        {bannerAlert}
        <StagePlayScreen scenery={scenery[view.stage?.index ?? 0]} view={view} busy={busy} send={send} portraitBase={portraitBase} attemptId={attemptId} />
      </div>
    );
  }

  return (
    <div className={`${styles.shell} min-h-screen`}>
      <header className={`${styles.header} shrink-0`}>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#ead5ae]">Historical adventure</p>
          <h1 className={`${styles.adventureTitle} mt-1 break-words`}>{view.stage?.title ?? view.briefing.name}</h1>
        </div>
        {headerActionGroup}
      </header>
      {bannerAlert}
      {view.phase === "briefing" ? (
        <BriefingScreen briefing={view.briefing} onContinue={() => { if (!busy) send({ type: "continue" }); }} />
      ) : view.phase === "stage" && view.stage?.intro ? (
        <StageIntroScreen stage={view.stage} onContinue={() => { if (!busy) send({ type: "continue" }); }} />
      ) : view.phase === "stage" ? (
        <StagePlayScreen scenery={scenery[view.stage?.index ?? 0]} view={view} busy={busy} send={send} portraitBase={portraitBase} attemptId={attemptId} />
      ) : view.phase === "reveal" && view.reveal ? (
        <RevealScreen reveal={view.reveal} footer={revealFooter} />
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
