"use client";

import { useEffect, useRef, useState } from "react";

import { pixelFont } from "./pixel-font";
import { pocketStyles } from "./pocket-ui";

const HOLD_MS = 1700;
const FADE_MS = 600;

/** "STAGE 2 OF 3 / A port that grew" over the stage painting. Any key or click skips it. */
export function StageTitleCard({ index, count, title, timePlace, artUrl, onDone }: {
  index: number;
  count: number;
  title: string;
  timePlace: string;
  artUrl: string | null;
  onDone: () => void;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => done.current(), reduced ? 1000 : HOLD_MS + FADE_MS);
    card.current?.focus({ preventScroll: true });
    const skip = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      event.preventDefault();
      done.current();
    };
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  return (
    <div
      ref={card}
      role="dialog"
      aria-modal="true"
      aria-label={`Stage ${index + 1} of ${count}: ${title}`}
      tabIndex={-1}
      onClick={() => done.current()}
      className={`${pocketStyles.root} ${pocketStyles.titleCard}`}
      style={{ ["--hold" as string]: `${HOLD_MS}ms` }}
    >
      {artUrl && !artFailed ? (
        <div className={pocketStyles.titleArt} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- stage art uses generated storage URLs */}
          <img src={artUrl} alt="" onError={() => setArtFailed(true)} />
        </div>
      ) : null}
      <div className={pocketStyles.titleShade} aria-hidden />
      <p className={`${pixelFont.className} ${pocketStyles.titleKicker}`}>Stage {index + 1} of {count}</p>
      <h2 className={`${pixelFont.className} ${pocketStyles.titleText}`}>{title}</h2>
      {timePlace.trim() ? <p className={`${pixelFont.className} ${pocketStyles.titleSub}`}>{timePlace}</p> : null}
      <span className={`${pixelFont.className} ${pocketStyles.titleSkip}`}>Click or press any key to skip</span>
    </div>
  );
}
