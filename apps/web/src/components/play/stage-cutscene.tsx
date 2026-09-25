"use client";

/**
 * The cinematic that opens a stage: where you are, what is happening, who you
 * are in it, and the choice waiting at the end. It is the briefing, staged, so
 * the whole text is present from the first frame and the reveal is only motion.
 */
import { ArrowRight, FastForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cutsceneBackdrop, cutsceneBeats } from "@/lib/play/cutscene";
import type { PlayState } from "@/lib/play/session";
import styles from "./stage-cutscene.module.css";

const BEAT_MS = 2600;

export function StageCutscene({ state, onBegin }: { state: PlayState; onBegin: () => void }) {
  const beats = cutsceneBeats(state);
  const backdrop = cutsceneBackdrop(state);
  const [told, setTold] = useState(false);
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    scene.current?.focus({ preventScroll: true });
    const done = window.setTimeout(() => setTold(true), BEAT_MS * beats.length);
    return () => {
      window.clearTimeout(done);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [beats.length]);

  return (
    <div
      ref={scene}
      className={`${styles.scene}${told ? ` ${styles.told}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={state.player.role}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const first = buttons[0];
          const last = buttons.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        } else if (event.key === "Escape") onBegin();
        else if (event.key === " " && !told) {
          event.preventDefault();
          setTold(true);
        }
      }}
    >
      {backdrop ? <div className={styles.backdrop} style={{ backgroundImage: `url(${backdrop})` }} aria-hidden /> : null}
      <div className={styles.wash} aria-hidden />
      <div className={styles.body}>
        {beats.map((beat, index) => (
          <div key={beat.id} className={styles.beat} style={{ animationDelay: `${index * BEAT_MS}ms` }}>
            <p className={styles.kicker}>{beat.kicker}</p>
            {beat.title ? <h2 className={styles.title}>{beat.title}</h2> : null}
            {beat.body ? <p className={styles.text}>{beat.body}</p> : null}
            {beat.items ? (
              <ul className={styles.list}>
                {beat.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.skip} onClick={() => (told ? onBegin() : setTold(true))}>
          <FastForward size={16} aria-hidden /> {told ? "Skip briefing" : "Show it all now"}
        </button>
        <button type="button" className={styles.begin} onClick={onBegin}>
          Begin as {state.player.name} <ArrowRight size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
