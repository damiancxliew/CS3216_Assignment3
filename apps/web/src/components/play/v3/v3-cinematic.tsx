"use client";
import type { MediaSnapshot } from "@adventure/spec-v3";
import { MediaCredit } from "./media-credit";

import { ArrowRight, ChevronRight, FastForward, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { useFullscreen } from "@/lib/play/fullscreen";
import type { V3CinematicBeat } from "@/lib/play/v3/cinematic";
import styles from "@/components/play/stage-cutscene.module.css";

function beatDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(12_000, Math.max(4_200, 2_400 + words * 260));
}

export function V3Cinematic({
  artUrl,
  artMetadata,
  beats,
  beginLabel,
  onBegin,
  onClose,
  muted,
  onToggleMuted,
  initiallySettled = false,
  dialogLabel,
}: {
  artUrl: string | null;
  artMetadata?: MediaSnapshot;
  beats: V3CinematicBeat[];
  beginLabel: string;
  onBegin: () => void;
  onClose?: () => void;
  muted: boolean;
  onToggleMuted: () => void;
  initiallySettled?: boolean;
  dialogLabel?: string;
}) {
  const fullscreen = useFullscreen();
  const [step, setStep] = useState(() => initiallySettled ? beats.length : 0);
  const [paused, setPaused] = useState(initiallySettled);
  const [imageFailed, setImageFailed] = useState(!artUrl);
  const scene = useRef<HTMLDivElement>(null);
  const beginButton = useRef<HTMLButtonElement>(null);
  const told = step >= beats.length;
  const hasEvidence = beats.some((beat) => beat.image || beat.journey);

  useEffect(() => {
    setImageFailed(!artUrl);
  }, [artUrl]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    scene.current?.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPaused(true);
      setStep(beats.length);
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [beats.length]);

  useEffect(() => {
    if (told) beginButton.current?.focus({ preventScroll: true });
  }, [told]);

  useEffect(() => {
    if (told || paused) return;
    const beat = beats[step];
    if (!beat) return;
    const handle = window.setTimeout(
      () => setStep((current) => Math.min(beats.length, current + 1)),
      beatDuration([beat.title, beat.body, ...(beat.items ?? [])].filter(Boolean).join(" ")),
    );
    return () => window.clearTimeout(handle);
  }, [beats, step, told, paused]);

  const next = () => setStep((current) => Math.min(beats.length, current + 1));

  return (
    <div
      ref={scene}
      className={styles.scene}
      data-phase={told ? "told" : "telling"}
      data-evidence={hasEvidence || undefined}
      data-paused={paused || told}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel ?? (onClose ? "Role brief" : "Adventure opening")}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')].filter((element) => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === scene.current)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          if (onClose) onClose();
          else onBegin();
        } else if (event.key === "ArrowRight" && !told) {
          event.preventDefault();
          next();
        } else if (event.key === "ArrowLeft" && step > 0) {
          event.preventDefault();
          setStep((current) => Math.min(beats.length - 1, current - 1));
        }
      }}
    >
      <div
        className={styles.art}
        onClick={() => {
          if (!told) next();
        }}
        style={imageFailed ? {
          background: "radial-gradient(ellipse at 55% 42%, #303631 0%, #141916 48%, #070908 100%)",
        } : undefined}
      >
        {artUrl && !imageFailed ? (
          <Image
            unoptimized
            fill
            src={artUrl}
            alt={artMetadata?.alt ?? ""}
            className={`h-full w-full ${artMetadata && artMetadata.origin !== "ai" ? "object-contain" : "object-cover"}`}
            onError={() => setImageFailed(true)}
          />
        ) : null}
      </div>
      <div className={styles.scrim} aria-hidden />
      <div className={`${styles.bar} ${styles.barTop}`} aria-hidden />
      <div className={`${styles.bar} ${styles.barBottom}`} aria-hidden />

      {artMetadata ? <div className="absolute bottom-2 right-3 z-20 max-w-[70%] rounded bg-black/75 px-2 py-1 text-xs text-white"><MediaCredit media={artMetadata} caption /></div> : null}
      <header className={styles.top}>
        <p className={styles.chapter}>Historical adventure</p>
        <div className={styles.controls}>
          {fullscreen.supported ? (
            <button type="button" className={styles.control} onClick={fullscreen.toggle} aria-label={fullscreen.active ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen.active}>
              {fullscreen.active ? <Minimize size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
              <span className={styles.controlLabel}>{fullscreen.active ? "Exit full screen" : "Full screen"}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={styles.control}
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? "Play" : "Pause"}
            aria-pressed={paused}
            disabled={told}
          >
            {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            <span className={styles.controlLabel}>{paused ? "Play" : "Pause"}</span>
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={onToggleMuted}
            aria-label={muted ? "Sound off" : "Sound on"}
            aria-pressed={!muted}
          >
            {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
            <span className={styles.controlLabel}>{muted ? "Sound off" : "Sound on"}</span>
          </button>
          {onClose ? (
            <button type="button" className={styles.control} onClick={onClose} aria-label={dialogLabel ? `Close ${dialogLabel.toLowerCase()}` : "Close role brief"}>
              <X size={16} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.captions}>
        {beats.map((beat, index) => (
          <section
            key={beat.id}
            className={`${styles.beat}${index === 0 ? ` ${styles.titleCard}` : ""}`}
            data-active={told || index === step}
          >
            {beat.image ? (
              <figure className={styles.evidenceImage}>
                <Image unoptimized width={1200} height={800} src={beat.image.src} alt={beat.image.alt} />
                <figcaption>{beat.image.caption} <a href={beat.image.href} target="_blank" rel="noreferrer">{beat.image.credit} ↗</a></figcaption>
              </figure>
            ) : null}
            <div className={styles.beatCopy}>
            <p className={styles.kicker}>{beat.kicker}</p>
            {beat.title ? <h2 className={styles.title}>{beat.title}</h2> : null}
            {beat.body ? <p className={styles.text}>{beat.body}</p> : null}
            {beat.items ? (
              <ul className={styles.list}>
                {beat.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            {beat.journey ? (
              <ol className={styles.journey} aria-label="Story journey, schematic rather than a travel route">
                {beat.journey.stops.map((stop, stopIndex) => <li key={stop} data-current={stopIndex === beat.journey!.current} aria-current={stopIndex === beat.journey!.current ? "step" : undefined}>{stop}</li>)}
              </ol>
            ) : null}
            </div>
          </section>
        ))}
      </div>

      <div className={styles.actions}>
        {told ? (
          <button ref={beginButton} type="button" className={styles.begin} onClick={onBegin}>
            {beginLabel} <ArrowRight size={18} aria-hidden />
          </button>
        ) : (
          <>
            <div className={styles.progress} aria-label={`Part ${Math.min(step + 1, beats.length)} of ${beats.length}`}>
              {beats.map((beat, index) => (
                <button
                  key={beat.id}
                  type="button"
                  className={styles.dot}
                  data-done={index < step}
                  data-current={index === step}
                  onClick={() => setStep(index)}
                  aria-label={`Show part ${index + 1}: ${beat.kicker}`}
                  aria-current={index === step ? "step" : undefined}
                />
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
    </div>
  );
}
