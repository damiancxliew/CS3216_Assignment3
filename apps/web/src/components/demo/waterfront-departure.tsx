"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Action } from "@adventure/play-contract";
import { V3CardDialog } from "@/components/play/v3/card-dialog";
import styles from "./waterfront-experience.module.css";

type Props = {
  choice: { id: string; title: string; outcome: string };
  send: (action: Action, settled?: (ok: boolean) => void) => void;
  onClose: () => void;
};

export function WaterfrontDeparture({ choice, send, onClose }: Props) {
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState(false);
  const leaving = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const lines = [
    {
      speaker: "You",
      text: "Before we go, what happens to everyone staying here?",
    },
    {
      speaker: "Gan Choo Neo",
      text: "The children still need care. Food and help cannot remain only promises.",
    },
    {
      speaker: "Lim Bo Seng",
      text: "Leaving carries a cost for my family. Keep that in mind when you judge my decision.",
    },
    {
      speaker: "You",
      text:
        choice.id === "family"
          ? "I have recommended support for the household. I still need to ask who can actually provide it."
          : "I will carry both the public purpose and the household’s needs into the next part of the story.",
    },
  ];
  const line = lines[Math.min(3, Math.floor(seconds / 4))];
  const advance = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setError(false);
    sendRef.current({ type: "enterRoom", roomId: "embark" }, (ok) => {
      if (!ok) {
        leaving.current = false;
        setError(true);
      }
    });
  }, []);
  useEffect(() => {
    const changed = () => setHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (paused || hidden || error) return;
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [paused, hidden, error]);
  useEffect(() => {
    if (seconds >= 18 && !error) advance();
  }, [seconds, error, advance]);

  return (
    <V3CardDialog
      title="A departure leaves people behind"
      eyebrow="Singapore · February 1942"
      footerText="Dramatised exchange · invented dialogue, not a historical quotation"
      closeLabel="Return to the quay"
      onClose={onClose}
    >
      <div
        className={styles.departure}
        data-paused={paused || hidden}
        aria-label="Illustrated animation: Lim walks down the quay, boards a boat, and the boat leaves. Gan remains ashore."
      >
        <div className={styles.skyline} />
        <div className={styles.bank} />
        <div className={styles.river} />
        <span className={styles.observer} />
        <span className={styles.gan} />
        <span className={styles.lim} />
        {choice.id === "family" && <span className={styles.parcel} />}
        <span className={styles.boat} />
        <span className={styles.sceneLabel}>SINGAPORE RIVER</span>
        <div className={styles.speech} role="status" aria-live="polite">
          <strong>{line.speaker}</strong>
          <p>{line.text}</p>
        </div>
      </div>
      <div className={styles.activity}>
        <div className={styles.sceneControls}>
          <button
            className={styles.primary}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "Resume scene" : "Pause scene"}
          </button>
          <button className={styles.primary} onClick={advance}>
            {error ? "Try continuing again" : "Continue to Malaya →"}
          </button>
        </div>
        <p>
          <strong>Your recommendation:</strong> {choice.title}
        </p>
        <p>{choice.outcome}</p>
        <p className={styles.credit}>
          Illustrative scene, not Lim’s documented boarding place, transport or
          conversation. Next: occupied Malaya, late 1943. Training abroad and
          the intervening journey are condensed into the next introduction.
        </p>
        {error ? (
          <p role="alert">
            The journey could not continue. Your progress is saved. Try again or
            return to the quay.
          </p>
        ) : (
          <p className={styles.credit}>
            The journey continues automatically after this exchange.
          </p>
        )}

        <details>
          <summary>Read the conversation</summary>
          {lines.map((item) => (
            <p key={item.speaker + item.text}>
              <strong>{item.speaker}:</strong> {item.text}
            </p>
          ))}
        </details>
      </div>
    </V3CardDialog>
  );
}
