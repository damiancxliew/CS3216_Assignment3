"use client";

/**
 * The cinematic that opens a stage: where you are, what is happening, who you
 * are in it, and the choice waiting at the end. The painting fills the screen
 * and the briefing plays over it as captions, one beat at a time, then settles
 * into a panel beside the art to review before play begins. Every beat is in
 * the DOM from the first frame, so assistive technology reads the whole
 * briefing; only which beat is shown changes.
 *
 * The first opening of a visit asks to go full screen. That click is also the
 * gesture browsers require before the ambience and music may start.
 */
import { ArrowRight, ChevronRight, FastForward, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ASSET_BASE } from "@/lib/play/appearance";
import { cutsceneArt, cutsceneBackdrop, cutsceneBeats, soundscapeMix, type CutsceneArt } from "@/lib/play/cutscene";
import { useFullscreen } from "@/lib/play/fullscreen";
import type { PlayState } from "@/lib/play/session";
import { CrackleClock, Soundscape } from "./cutscene-sound";
import { CutsceneTheatre } from "./cutscene-theatre";
import styles from "./stage-cutscene.module.css";

/** Long enough to read a beat at a relaxed pace, never so long it stalls. */
function beatDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(12_000, Math.max(4_200, 2_400 + words * 260));
}

export function StageCutscene({ state, onBegin, muted, onToggleMuted, askFullscreen = false }: {
  state: PlayState;
  onBegin: () => void;
  muted: boolean;
  onToggleMuted: () => void;
  /** Offer full screen before the opening plays (the first opening of a visit). */
  askFullscreen?: boolean;
}) {
  const beats = cutsceneBeats(state);
  const fullscreen = useFullscreen();
  const [gate, setGate] = useState(askFullscreen);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const told = step >= beats.length;
  const scene = useRef<HTMLDivElement>(null);
  // State is refetched while the opening is up; keep the painting (and everything built on it) stable.
  const artKey = JSON.stringify(cutsceneArt(state));
  const art = useMemo(() => JSON.parse(artKey) as CutsceneArt | null, [artKey]);
  const mix = useMemo(() => (art?.scene ? soundscapeMix(art.scene) : null), [art]);
  const clock = useMemo(() => new CrackleClock(mix?.fire?.crackles ?? 0), [mix]);
  const sound = useRef<Soundscape | null>(null);
  const mutedRef = useRef(muted);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // With the full-screen question up, its first button holds focus instead.
    if (!askFullscreen) scene.current?.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPaused(true);
      setStep(Number.MAX_SAFE_INTEGER);
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the opening's first frame decides this
  }, []);

  // Captions advance on their own unless the player has paused or is still choosing how to play.
  useEffect(() => {
    if (told || paused || gate) return;
    const beat = beats[step]!;
    const handle = window.setTimeout(() => setStep((current) => current + 1), beatDuration([beat.title, beat.body, ...(beat.items ?? [])].filter(Boolean).join(" ")));
    return () => window.clearTimeout(handle);
  }, [beats, step, told, paused, gate]);

  // The ambience the painting shows, started by the first gesture the browser allows it to.
  useEffect(() => {
    const soundscape = mix ? new Soundscape(mix, `${ASSET_BASE}/audio/sfx`) : null;
    sound.current = soundscape;
    const unsubscribe = clock.subscribe((strength) => soundscape?.crackle(strength));
    clock.start();
    const start = () => {
      if (!mutedRef.current) soundscape?.start();
    };
    if (navigator.userActivation?.hasBeenActive) start();
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      unsubscribe();
      clock.stop();
      soundscape?.dispose();
      sound.current = null;
    };
  }, [mix, clock]);

  useEffect(() => {
    mutedRef.current = muted;
    sound.current?.setMuted(muted);
    if (!muted) sound.current?.start();
  }, [muted]);

  const next = () => setStep((current) => Math.min(beats.length, current + 1));
  const play = (full: boolean) => {
    if (full) void fullscreen.enter();
    setGate(false);
    scene.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={scene}
      className={styles.scene}
      data-phase={gate ? "gate" : told ? "told" : "telling"}
      data-side={art?.captionSide ?? "left"}
      role="dialog"
      aria-modal="true"
      aria-label={state.player.role}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(gate ? `.${styles.gate} button:not(:disabled)` : "button:not(:disabled)")]
            .filter((button) => button.getClientRects().length > 0);
          const first = buttons[0];
          const last = buttons.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
          return;
        }
        if (gate) return;
        if (event.key === "Escape") onBegin();
        else if (event.target !== event.currentTarget) return;
        else if ((event.key === " " || event.key === "Enter" || event.key === "ArrowRight") && !told) {
          event.preventDefault();
          next();
        } else if (event.key === "ArrowLeft" && step > 0) {
          event.preventDefault();
          setStep((current) => Math.min(beats.length - 1, current - 1));
        }
      }}
    >
      {/* Clicking the painting moves the captions on, as in most games. */}
      <div className={styles.art} onClick={() => !gate && !told && next()}>
        <CutsceneTheatre art={art} fallback={cutsceneBackdrop(state)} paused={paused} clock={clock} />
      </div>
      <div className={styles.scrim} aria-hidden />
      <div className={`${styles.bar} ${styles.barTop}`} aria-hidden />
      <div className={`${styles.bar} ${styles.barBottom}`} aria-hidden />

      <header className={styles.top}>
        <p className={styles.chapter}>
          Chapter {String(state.stage.index + 1).padStart(2, "0")} <span aria-hidden>·</span> {state.stage.title}
        </p>
        <div className={styles.controls}>
          {fullscreen.supported ? (
            <button type="button" className={styles.control} onClick={fullscreen.toggle} aria-pressed={fullscreen.active}>
              {fullscreen.active ? <Minimize size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
              <span className={styles.controlLabel}>{fullscreen.active ? "Exit full screen" : "Full screen"}</span>
            </button>
          ) : null}
          <button type="button" className={styles.control} onClick={onToggleMuted} aria-pressed={muted}>
            {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
            <span className={styles.controlLabel}>{muted ? "Sound off" : "Sound on"}</span>
          </button>
          <button type="button" className={styles.control} onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
            {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            <span className={styles.controlLabel}>{paused ? "Resume" : "Pause"}</span>
          </button>
        </div>
      </header>

      <div className={styles.captions}>
        {beats.map((beat, index) => (
          <section key={beat.id} className={`${styles.beat}${beat.id === "place" ? ` ${styles.titleCard}` : ""}`} data-active={told || index === step}>
            <p className={styles.kicker}>{beat.kicker}</p>
            {beat.title ? <h2 className={styles.title}>{beat.title}</h2> : null}
            {beat.body ? <p className={styles.text}>{beat.body}</p> : null}
            {beat.items ? (
              <ul className={styles.list}>
                {beat.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <div className={styles.actions}>
        {told ? (
          <>
            <p className={styles.hint}>Esc also begins</p>
            <button type="button" className={styles.begin} onClick={onBegin}>
              Begin as {state.player.name} <ArrowRight size={18} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <div className={styles.progress} aria-label={`Part ${Math.min(step + 1, beats.length)} of ${beats.length}`}>
              {beats.map((beat, index) => (
                <button key={beat.id} type="button" className={styles.dot} data-done={index < step} data-current={index === step} onClick={() => setStep(index)} aria-label={`Show part ${index + 1}: ${beat.kicker}`} aria-current={index === step ? "step" : undefined} />
              ))}
            </div>
            <div className={styles.buttons}>
              <button type="button" className={styles.skip} onClick={() => setStep(beats.length)}>
                <FastForward size={15} aria-hidden /> Skip
              </button>
              <button type="button" className={styles.next} onClick={next}>
                Continue <ChevronRight size={17} aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>

      {gate ? (
        <div className={styles.gate}>
          <div className={styles.gateCard} role="group" aria-labelledby="cutscene-gate-title">
            <p className={styles.kicker}>Historical Adventures</p>
            <h2 id="cutscene-gate-title" className={styles.gateTitle}>{state.stage.title}</h2>
            <p className={styles.gateText}>
              {fullscreen.supported ? "This adventure is best played in full screen, with sound on." : "Turn your sound on for the full experience."}
            </p>
            <div className={styles.gateButtons}>
              {fullscreen.supported ? (
                <>
                  <button type="button" className={styles.begin} onClick={() => play(true)} autoFocus>
                    <Maximize size={17} aria-hidden /> Play in full screen
                  </button>
                  <button type="button" className={styles.skip} onClick={() => play(false)}>
                    Continue in window
                  </button>
                </>
              ) : (
                <button type="button" className={styles.begin} onClick={() => play(false)} autoFocus>
                  Start <ArrowRight size={17} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
