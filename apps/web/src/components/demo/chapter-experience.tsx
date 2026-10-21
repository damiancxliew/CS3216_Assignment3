"use client";
import { useEffect, useRef, useState } from "react";
import type { Action, PlayerView } from "@adventure/play-contract";
import type { Point } from "@adventure/game-core";
import type { StageExperience } from "@/components/play/v3/stage-play-screen";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import { chapterTasks } from "@/lib/demo/chapter-progress";
import { STORY_EXIT, storyExitLabels } from "@/lib/demo/story-maps";
import type { DemoV3State } from "@/lib/demo/v3-session";
import { stages } from "@/lib/demo/lim-bo-seng";
import { demoCinematics } from "@/lib/demo/cinematics";
import {
  WaterfrontRecord,
  type WaterfrontRecordId,
} from "./waterfront-records";
import { ChapterConsequence } from "./chapter-consequence";
import styles from "./waterfront-experience.module.css";

type Send = (action: Action, settled?: (ok: boolean) => void) => void;
export function useChapterExperience(
  getState: () => DemoV3State,
  restartKey: number,
  saveScope: string | null,
) {
  const [record, setRecord] = useState<
    WaterfrontRecordId | "portraits" | "locked" | null
  >(null);
  const [seen, setSeen] = useState<number[]>([]);
  const [destination, setDestination] = useState<Point | null>(null);
  const [error, setError] = useState(false);
  const entering = useRef(false);
  const lastStage = useRef(-1);
  const storageKey = saveScope ? `${saveScope}.consequences` : null;
  useEffect(() => {
    setRecord(null);
    setDestination(null);
    setError(false);
    entering.current = false;
    lastStage.current = -1;
    let saved: number[] = [];
    try {
      if (storageKey && restartKey) localStorage.removeItem(storageKey);
      const value = storageKey
        ? JSON.parse(localStorage.getItem(storageKey) || "[]")
        : [];
      if (Array.isArray(value))
        saved = value.filter((n) => Number.isInteger(n) && n > 0 && n < 5);
    } catch {
      /* Scene acknowledgement is optional; core progress is saved separately. */
    }
    setSeen(saved);
  }, [storageKey, restartKey]);
  return (view: PlayerView, send: Send): StageExperience | undefined => {
    const index = view.stage?.index;
    if (index === undefined || index === 0 || view.phase !== "stage") return;
    const state = getState(),
      chapter = stages[index];
    const tasks = chapterTasks(state),
      ready = tasks.every((t) => t.done);
    const decision = state.decisions.find((d) => d.stage === index);
    const showScene = Boolean(
      state.departureReady && decision && !seen.includes(index),
    );
    const close = () => {
      setRecord(null);
      requestAnimationFrame(() =>
        document.querySelector<HTMLCanvasElement>("canvas")?.focus(),
      );
    };
    const acknowledge = () => {
      const next = [...new Set([...seen, index])];
      setSeen(next);
      try {
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Replay remains available. */
      }
      close();
    };
    return {
      destination,
      movementLocked: Boolean(record || showScene),
      hideDecision:
        Boolean(state.departureReady) ||
        tasks.some((t) => t.id !== "decision" && !t.done),
      decisionHint:
        "Make one recommendation, watch its consequence, then explore or walk through the exit.",
      mission: (
        <div className={styles.mission}>
          <p className={styles.dateline}>{chapter.place}</p>
          <p className={styles.title}>
            {ready ? `${storyExitLabels[index]} is open` : chapter.title}
          </p>
          <div className={styles.tasks} aria-label="Stage goals">
            {tasks.map((task, i) => (
              <span key={task.id}>
                {task.done ? "✓" : i + 1} {task.label}
              </span>
            ))}
          </div>
          <p>
            {ready
              ? `Walk through the signposted ${storyExitLabels[index].toLowerCase()} to continue. No extra decision or click needed.`
              : "Three goals. Click objects and photographs for optional discoveries."}
          </p>
          <details className={styles.recordsMenu}>
            <summary>Optional discoveries</summary>
            <button onClick={() => setRecord("portraits")}>
              Photographs of the people you meet
            </button>
            {(index === 3 || index === 4) && (
              <button onClick={() => setRecord("newspaper")}>
                Inspect the occupation newspaper
              </button>
            )}
            {index === 3 && (
              <>
                <button onClick={() => setRecord("currency")}>
                  Inspect occupation money
                </button>
                <button onClick={() => setRecord("rickshaw")}>
                  Rickshaw photograph
                </button>
              </>
            )}
            {decision && (
              <button onClick={() => setSeen(seen.filter((s) => s !== index))}>
                Replay your consequence
              </button>
            )}
          </details>
          {error && (
            <p role="alert">
              The exit could not open. Walk out of the passage and back in to
              try again.
            </p>
          )}
        </div>
      ),
      onInspect(id) {
        if (id === "chapter-portrait") setRecord("portraits");
        else if (id === "chapter-newsstand") setRecord("newspaper");
        else if (id === "chapter-currency") setRecord("currency");
        else if (id === "chapter-rickshaw") setRecord("rickshaw");
        else if (id === "chapter-exit") {
          if (ready) setDestination({ ...STORY_EXIT });
          else setRecord("locked");
        } else return false;
        return true;
      },
      onArrive(point) {
        if (lastStage.current !== index) {
          lastStage.current = index;
          entering.current = false;
        }
        const inside = point.x >= 26 && point.x <= 28 && point.y === 18;
        if (inside && !entering.current) {
          setDestination(null);
          if (ready)
            send({ type: "enterRoom", roomId: "embark" }, (ok) =>
              setError(!ok),
            );
          else setRecord("locked");
        }
        entering.current = inside;
      },
      overlay: (
        <>
          {showScene && decision && (
            <ChapterConsequence
              key={`${index}-${decision.choice}`}
              stage={index}
              choiceId={decision.choice}
              onClose={acknowledge}
            />
          )}
          {record === "locked" && (
            <V3ScrollDialog
              title="Before you leave"
              footerText="Explore · speak · recommend"
              eyebrow={storyExitLabels[index]}
              closeLabel="Return to exploring"
              onClose={close}
            >
              <div className={styles.activity}>
                <p>Finish these goals to open the passage:</p>
                {tasks
                  .filter((t) => !t.done)
                  .map((t) => (
                    <p key={t.id}>{t.label}</p>
                  ))}
              </div>
            </V3ScrollDialog>
          )}
          {record === "portraits" && (
            <V3ScrollDialog
              title="The people behind the portraits"
              footerText="Real photographs · illustrated likeness sprites"
              eyebrow={chapter.title}
              closeLabel="Return to exploring"
              onClose={close}
            >
              <div className={styles.activity}>
                {demoCinematics.stages[index]
                  .filter((b) => b.id.startsWith("person-"))
                  .map((beat) => (
                    <figure key={beat.id}>
                      <h3 className={styles.title}>{beat.title}</h3>
                      {/* eslint-disable-next-line @next/next/no-img-element -- preserve the archival photograph and its full proportions */}
                      <img
                        className={styles.explorationImage}
                        src={beat.image!.src}
                        alt={beat.image!.alt}
                      />
                      <figcaption>
                        <p>{beat.image!.caption}</p>
                        <p className={styles.credit}>
                          {beat.image!.credit} ·{" "}
                          <a
                            href={beat.image!.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Original record ↗
                          </a>
                        </p>
                      </figcaption>
                    </figure>
                  ))}
              </div>
            </V3ScrollDialog>
          )}
          {record && record !== "locked" && record !== "portraits" && (
            <WaterfrontRecord id={record} onClose={close} occupationContext />
          )}
        </>
      ),
    };
  };
}
