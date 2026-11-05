"use client";
import type { ResolvedImage } from "@/lib/v3/media/resolvers";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import { Clapperboard, IdCard, Volume2, VolumeX } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { PlayerView } from "@adventure/play-contract";
import { selectMusicTrack } from "@adventure/game-client/music";

import { EpilogueScreen } from "@/components/play/v3/epilogue-screen";
import { InterviewScreen, journeyPills } from "@/components/play/v3/interview-screen";
import { MapBackdrop } from "@/components/play/v3/map-backdrop";
import { RevealScreen } from "@/components/play/v3/reveal-screen";
import { StagePlayScreen, type StageExperience } from "@/components/play/v3/stage-play-screen";
import { V3Cinematic } from "@/components/play/v3/v3-cinematic";
import { HudButton, PocketLogo } from "@/components/play/v3/pocket-ui";
import { pixelFont } from "@/components/play/v3/pixel-font";
import { RoleCard } from "@/components/play/v3/role-card";
import { StageTitleCard } from "@/components/play/v3/stage-title-card";
import { useV3Play } from "@/components/play/v3/use-v3-play";
import styles from "@/components/play/adventure-chrome.module.css";
import { backdropFromView, type V3MapBackdrop } from "@/lib/play/v3/backdrop";
import {
  BRIEFING_BEGIN_LABEL,
  type V3CinematicBeat,
  briefingBeats,
  STAGE_INTRO_BEGIN_LABEL,
  stageIntroBeats,
} from "@/lib/play/v3/cinematic";
import { stageArtUrl } from "@/lib/play/v3/stage-art";
import { v3Ambient } from "@/lib/play/v3/atmosphere";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";
import { useV3SoundCues } from "@/components/play/v3/v3-sound";
import { ASSET_BASE, facesetUrl, PLAYER_CHARACTER } from "@/lib/play/appearance";
import { useStageMusic } from "@/components/play/sound";

export function V3PlayClient({
  attemptId,
  scenery = [],
  initialView,
  initialRevision,
  portraitBase = null,
  stageArtBase = null,
  stageImages,
  backdrop = null,
  makeClient,
  headerActions,
  revealFooter,
  busyLabel = "Saving…",
  cinematics,
  stageExperience,
}: {
  stageExperience?: (view: PlayerView, send: (action: import("@adventure/play-contract").Action, onSettled?: (succeeded: boolean) => void) => void) => StageExperience | undefined;
  attemptId: string;
  scenery?: V3StageScenery[];
  initialView: PlayerView;
  initialRevision: number;
  portraitBase?: PortraitBase;
  stageArtBase?: string | null;
  stageImages?: ResolvedImage[];
  backdrop?: V3MapBackdrop | null;
  makeClient?: () => PlayClient;
  headerActions?: ReactNode;
  revealFooter?: ReactNode;
  busyLabel?: string;
  cinematics?: { briefing: V3CinematicBeat[]; stages: V3CinematicBeat[][] };
}) {
  const [roleBriefOpen, setRoleBriefOpen] = useState(false);
  const [introReplayOpen, setIntroReplayOpen] = useState(false);
  const [titleShown, setTitleShown] = useState<number | null>(null);
  const { view, busy, banner, send, clearBanner } = useV3Play(
    attemptId,
    initialView,
    initialRevision,
    makeClient,
  );
  const experience = stageExperience?.(view, send);
  const { muted, toggleMuted, cues } = useV3SoundCues(view, banner?.message ?? null);
  const endMusic = view.phase === "epilogue" || view.phase === "interview" || view.phase === "reveal";
  const musicStageIndex = view.stage?.index ?? 0;
  const musicTimePlace = view.stage?.timePlace ?? "";
  const musicTitle = view.stage?.title ?? "";
  const musicUrl = useMemo(() => {
    if (endMusic) return "/game/ninja/audio/music/peaceful.ogg";
    if (view.phase !== "briefing" && view.phase !== "stage") return null;
    const track = selectMusicTrack(
      v3Ambient({ timePlace: musicTimePlace, title: musicTitle }),
      `${attemptId}:${musicStageIndex}`,
    );
    return `${ASSET_BASE}/audio/music/${track}.ogg`;
  }, [attemptId, endMusic, musicStageIndex, musicTimePlace, musicTitle, view.phase]);
  useStageMusic(musicUrl, muted, endMusic ? 0.22 : undefined);
  const stageMap = backdropFromView(view);
  const [lastMap, setLastMap] = useState(backdrop);
  if (
    stageMap &&
    (lastMap?.rooms !== stageMap.rooms || lastMap.characters !== stageMap.characters || lastMap.currentRoomId !== stageMap.currentRoomId)
  ) {
    setLastMap(stageMap);
  }

  const bannerAlert = banner ? (
    // Overlaid, so an error never shifts the map under the player's feet.
    <div role="alert" className="fixed left-1/2 top-14 z-50 flex w-[min(56rem,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-signal bg-signal-wash px-4 py-3 text-sm font-semibold text-ink shadow-[3px_3px_0_var(--ink)]">
      <span>{banner.message}</span>
      <button type="button" onClick={clearBanner} className="min-h-9 rounded-lg px-2 underline">Dismiss</button>
    </div>
  ) : null;
  // The opening and stage titles use the player's face; a generated walking sheet has no face crop yet.
  const playerPortrait = facesetUrl(PLAYER_CHARACTER);
  const hudButtons = (
    <>
      {busy ? <span role="status" className="sr-only">{busyLabel}</span> : null}
      {headerActions ? <div className={`${styles.headerActions} rounded-xl border-4 border-[#1f2433] bg-[#3b3026] px-2 py-1.5 shadow-[0_4px_0_rgb(31_36_51/0.6)]`}>{headerActions}</div> : null}
      {cinematics && view.phase === "stage" && !view.stage?.intro ? (
        <HudButton label="Stage introduction" onClick={() => setIntroReplayOpen(true)}><Clapperboard size={26} aria-hidden /></HudButton>
      ) : null}
      {view.phase === "stage" && view.stage?.intro === null ? (
        <HudButton label="Role brief" aria-haspopup="dialog" aria-expanded={roleBriefOpen} aria-keyshortcuts="R" onClick={() => setRoleBriefOpen(true)}>
          <IdCard size={28} aria-hidden />
        </HudButton>
      ) : null}
      <HudButton label={muted ? "Sound off" : "Sound on"} aria-pressed={!muted} onClick={toggleMuted}>
        {muted ? <VolumeX size={26} aria-hidden /> : <Volume2 size={26} aria-hidden />}
      </HudButton>
    </>
  );
  const endScreen =
    view.phase === "epilogue" && view.epilogue
      ? { label: "Epilogue", screen: <EpilogueScreen epilogue={view.epilogue} busy={busy} send={send} /> }
      : view.phase === "interview" && view.interview
        ? { label: "The Interview", screen: <InterviewScreen interview={view.interview} notes={view.notes} busy={busy} send={send} journey={journeyPills({ notes: view.notes.length, documents: view.documents.length, decisions: view.stage?.count ?? 0 })} /> }
        : null;

  if (endScreen) {
    return (
      <div className={`${styles.shell} relative flex h-dvh min-h-0 flex-col`}>
        <h1 className="sr-only">{view.briefing.name}: {endScreen.label}</h1>
        {bannerAlert}
        <MapBackdrop
          attemptId={attemptId}
          backdrop={lastMap}
          scenery={scenery[lastMap?.stageIndex ?? 0]}
          ambient={{ id: view.stage ? v3Ambient(view.stage) : "clear", intensity: 1 }}
          audio={{ muted, cues }}
        >
          {endScreen.screen}
        </MapBackdrop>
        <div className="absolute right-2 top-2 z-40 flex items-start gap-2 sm:right-4 sm:top-4">{hudButtons}</div>
      </div>
    );
  }

  if (view.phase === "stage" && view.stage && view.stage.intro === null) {
    return (
      <div className={`${styles.shell} flex h-dvh min-h-0 flex-col`}>
        <h1 className="sr-only">{view.briefing.name}: Stage {view.stage.index + 1} of {view.stage.count}, {view.stage.title}</h1>
        {bannerAlert}
        <StagePlayScreen experience={experience} scenery={scenery[view.stage?.index ?? 0]} view={view} busy={busy} send={send} portraitBase={portraitBase} attemptId={attemptId} movementLocked={roleBriefOpen || introReplayOpen} onOpenRoleBrief={() => setRoleBriefOpen(true)} ambient={{ id: v3Ambient(view.stage), intensity: 1 }} audio={{ muted, cues }} hud={hudButtons} />
        {introReplayOpen && cinematics ? <V3Cinematic artUrl={null} beats={cinematics.stages[view.stage.index]} beginLabel="Back to the map" dialogLabel="Stage introduction" onBegin={() => setIntroReplayOpen(false)} onClose={() => setIntroReplayOpen(false)} muted={muted} onToggleMuted={toggleMuted} /> : null}
        {roleBriefOpen ? (
          <RoleCard
            briefing={view.briefing}
            stage={view.stage}
            portraitUrl={playerPortrait}
            artUrl={stageImages ? stageImages[view.stage.index]?.url ?? null : stageArtUrl(stageArtBase, view.stage.index)}
            beginLabel="Back to the map"
            onBegin={() => setRoleBriefOpen(false)}
            onClose={() => setRoleBriefOpen(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${styles.shell} min-h-screen`}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b-4 border-[#1f2433] bg-[#26304a] px-3 py-2 sm:px-6">
        <PocketLogo width={132} />
        <h1 className="sr-only">{view.stage?.title ?? view.briefing.name}</h1>
        <p className={`${pixelFont.className} min-w-0 flex-1 truncate text-base font-bold text-[#fffaf0] sm:text-lg`} aria-hidden>{view.phase === "reveal" ? "What really happened" : view.briefing.name}</p>
        <div className="flex shrink-0 items-center gap-2">{hudButtons}</div>
      </header>
      {bannerAlert}
      {view.phase === "briefing" && !cinematics ? (
        <RoleCard
          key="briefing"
          briefing={view.briefing}
          stage={view.stage}
          portraitUrl={playerPortrait}
          artUrl={stageImages ? stageImages[0]?.url ?? null : stageArtUrl(stageArtBase, 0)}
          beginLabel={BRIEFING_BEGIN_LABEL}
          busy={busy}
          showLogo
          onBegin={() => { if (!busy) send({ type: "continue" }); }}
        />
      ) : view.phase === "briefing" ? (
        <V3Cinematic
          key="briefing"
          artUrl={stageImages ? stageImages[0]?.url ?? null : stageArtUrl(stageArtBase, 0)}
            artMetadata={stageImages?.[0]?.metadata}
          beats={cinematics?.briefing ?? briefingBeats(view.briefing, view.stage?.index === 0 ? view.stage : undefined)}
          beginLabel={BRIEFING_BEGIN_LABEL}
          onBegin={() => { if (!busy) send({ type: "continue" }); }}
          muted={muted}
          onToggleMuted={toggleMuted}
        />
      ) : view.phase === "stage" && view.stage?.intro && titleShown !== view.stage.index ? (
        <StageTitleCard
          key={`stage-title-${view.stage.index}`}
          index={view.stage.index}
          count={view.stage.count}
          title={view.stage.title}
          timePlace={view.stage.timePlace}
          artUrl={stageImages ? stageImages[view.stage.index]?.url ?? null : stageArtUrl(stageArtBase, view.stage.index)}
          onDone={() => setTitleShown(view.stage?.index ?? null)}
        />
      ) : view.phase === "stage" && view.stage?.intro ? (
        <V3Cinematic
          key={`stage-intro-${view.stage.index}`}
          artUrl={stageImages ? stageImages[view.stage.index]?.url ?? null : stageArtUrl(stageArtBase, view.stage.index)}
          artMetadata={stageImages?.[view.stage.index]?.metadata}
          beats={cinematics ? [...stageIntroBeats(view.stage).filter((beat) => beat.id === "what-happened"), ...cinematics.stages[view.stage.index], ...stageIntroBeats(view.stage).filter((beat) => beat.id === "preparation")] : stageIntroBeats(view.stage)}
          beginLabel={STAGE_INTRO_BEGIN_LABEL}
          onBegin={() => { if (!busy) send({ type: "continue" }); }}
          muted={muted}
          onToggleMuted={toggleMuted}
        />
      ) : view.phase === "stage" ? (
        <StagePlayScreen experience={experience} scenery={scenery[view.stage?.index ?? 0]} view={view} busy={busy} send={send} portraitBase={portraitBase} attemptId={attemptId} movementLocked={roleBriefOpen || introReplayOpen} onOpenRoleBrief={() => setRoleBriefOpen(true)} ambient={{ id: view.stage ? v3Ambient(view.stage) : "clear", intensity: 1 }} audio={{ muted, cues }} />
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
