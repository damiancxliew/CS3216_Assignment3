"use client";

import type { StageView } from "@adventure/play-contract";
import { ArrowRight, Star, Volume2, VolumeX } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { asSentence, briefExcerpt } from "@/lib/play/v3/cinematic";
import styles from "./brief.module.css";
import { pixelFont } from "./pixel-font";
import { HudButton, pocketStyles } from "./pocket-ui";
import { StageTrack, stageTrack } from "./role-card";

/**
 * The stage opening on one screen: the stage painting with its number, title and time and place set
 * large, and a short brief card beside it (below it on phones) with what happened, two sentences of
 * narration, the new main quest and the journey track. "Start exploring" is always in view.
 */
export function StageBrief({ stage, artUrl, beginLabel, onBegin, busy = false, muted, onToggleMuted }: {
  stage: StageView;
  artUrl: string | null;
  beginLabel: string;
  onBegin: () => void;
  busy?: boolean;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const begin = useRef<HTMLButtonElement>(null);
  const narrationText = useRef<HTMLParagraphElement>(null);
  const titleId = useId();
  const prediction = stage.intro?.predictionReveal ?? null;
  // "What happened" already tells the consequence, so the narration keeps a single sentence beside it.
  const narration = briefExcerpt(stage.intro?.narration ?? "", prediction?.actual.trim() ? 1 : 2);
  const question = stage.centralQuestion.trim();
  const track = stageTrack(stage);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    begin.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`${pocketStyles.root} ${styles.brief}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) onBegin();
        } else if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")].filter((element) => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      {artUrl && !artFailed ? (
        <div className={styles.briefArt} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- stage art uses generated storage URLs */}
          <img src={artUrl} alt="" onError={() => setArtFailed(true)} />
        </div>
      ) : null}
      <div className={styles.briefShade} aria-hidden />
      <div className={styles.briefSound}>
        <HudButton label={muted ? "Sound off" : "Sound on"} aria-pressed={!muted} onClick={onToggleMuted}>
          {muted ? <VolumeX size={24} aria-hidden /> : <Volume2 size={24} aria-hidden />}
        </HudButton>
      </div>

      <header className={styles.briefTitle}>
        <p className={`${pixelFont.className} ${styles.briefKicker}`}>Stage {stage.index + 1} of {stage.count}</p>
        <h2 id={titleId} className={`${pixelFont.className} ${styles.briefHeading}`}>{stage.title}</h2>
        {stage.timePlace.trim() ? <p className={`${pixelFont.className} ${styles.briefWhen}`}>{stage.timePlace}</p> : null}
      </header>

      <section aria-label="Stage brief" className={styles.briefCard}>
        <span className={`${pixelFont.className} ${styles.briefTag}`} aria-hidden>Stage brief</span>
        <div className={styles.briefBody}>
          {prediction && prediction.actual.trim() ? (
            <div className={styles.reveal}>
              <h3 className={`${pixelFont.className} ${styles.label}`}>What happened</h3>
              <p className={styles.revealText}>{asSentence(prediction.actual)}</p>
              {prediction.predicted.trim() ? <p className={styles.revealGuess}>You predicted: {asSentence(prediction.predicted)}</p> : null}
            </div>
          ) : null}
          {narration.lead ? (
            <p ref={narrationText} tabIndex={-1} className={`${styles.narration} outline-none`}>
              {narration.lead}
              {narration.rest ? (
                expanded
                  ? <> {narration.rest}</>
                  : <button type="button" className={styles.readMore} aria-expanded={false} onClick={() => { setExpanded(true); requestAnimationFrame(() => narrationText.current?.focus({ preventScroll: true })); }}>Read more</button>
              ) : null}
            </p>
          ) : null}
          {question ? (
            <div className={styles.quest}>
              <span className={styles.questStar} aria-hidden><Star size={17} strokeWidth={2.5} fill="currentColor" /></span>
              <div>
                <h3 className={`${pixelFont.className} ${styles.label}`}>New main quest</h3>
                <p className={styles.questText}>{question}</p>
              </div>
            </div>
          ) : null}
          <StageTrack stops={track} tone="paper" />
        </div>
        <div className={styles.briefActions}>
          <button ref={begin} type="button" disabled={busy} onClick={onBegin} className={`${pixelFont.className} ${styles.primary}`}>
            {beginLabel} <ArrowRight size={20} aria-hidden />
          </button>
        </div>
      </section>
    </div>
  );
}
