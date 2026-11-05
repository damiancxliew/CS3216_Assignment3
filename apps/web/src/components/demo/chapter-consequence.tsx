"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { V3CardDialog } from "@/components/play/v3/card-dialog";
import { stages } from "@/lib/demo/lim-bo-seng";
import styles from "./chapter-consequence.module.css";
import shared from "./waterfront-experience.module.css";

const backdrops = ["", "liaison"];
/** An illustrated consequence of the student's recommendation, not invented testimony. */
export function ChapterConsequence({
  stage,
  choiceId,
  onClose,
}: {
  stage: number;
  choiceId: string;
  onClose: () => void;
}) {
  const chapter = stages[stage];
  const choice = chapter.choices.find((c) => c.id === choiceId)!;
  const [beat, setBeat] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lines = [
    { speaker: "You", text: choice.title + "." },
    { speaker: "Scene narrator", text: choice.outcome.split(". ")[0] + "." },
    {
      speaker: "You",
      text: `The trade-off I must acknowledge: ${choice.cost.charAt(0).toLowerCase()}${choice.cost.slice(1)}`,
    },
  ];
  useEffect(() => {
    const changed = () => setHidden(document.visibilityState !== "visible");
    changed();
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (paused || hidden || beat >= 2) return;
    const timer = window.setTimeout(() => setBeat((b) => b + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [beat, paused, hidden]);
  return (
    <V3CardDialog
      title="Your choice in motion"
      eyebrow={`Stage ${stage + 1} · ${chapter.title}`}
      footerText="Illustrated learning scenario · movements and dialogue are reconstructed"
      closeLabel="Return to exploring"
      onClose={onClose}
    >
      <div
        className={styles.scene}
        data-action={choice.animation}
        data-paused={paused || hidden}
        aria-label={`Illustrated consequence: ${choice.outcome}`}
      >
        <div
          className={styles.facade}
          style={{
            backgroundImage: `url(/demo/lim-bo-seng/map/chapter-${backdrops[stage]}-full.svg)`,
          }}
        />
        <div className={styles.ground} />
        {chapter.npcs.slice(0, 2).map((npc, i) => (
          <span
            key={npc.id}
            className={styles.person}
            data-actor={i === choice.actor}
            style={
              {
                "--start": `${i ? 66 : 18}%`,
                "--end": `${i ? 56 : 32}%`,
                backgroundImage: `url(/demo/lim-bo-seng/sprites/${npc.id}.png)`,
              } as CSSProperties
            }
          />
        ))}
        <span className={styles.parcel} />
        <div className={shared.speech} role="status">
          <strong>{lines[beat].speaker}</strong>
          <p>{lines[beat].text}</p>
        </div>
      </div>
      <div className={shared.activity}>
        <div className={shared.sceneControls}>
          <button
            className={shared.primary}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume scene" : "Pause scene"}
          </button>
          <button className={shared.primary} onClick={onClose}>
            Return to exploring →
          </button>
        </div>
        <div className={shared.feedback}>
          <strong>What your recommendation changes</strong>
          <p>{choice.outcome}</p>
          <p>
            <strong>Trade-off: </strong>
            {choice.cost}
          </p>
        </div>
        <p>
          Your recommendation is saved. Explore anything you missed, then walk
          through the marked exit.
        </p>
        <details>
          <summary>Read the scene</summary>
          {lines.map((line) => (
            <p key={line.speaker + line.text}>
              <strong>{line.speaker}:</strong> {line.text}
            </p>
          ))}
        </details>
      </div>
    </V3CardDialog>
  );
}
