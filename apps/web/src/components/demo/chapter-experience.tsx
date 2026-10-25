"use client";
import { useEffect, useRef, useState } from "react";
import type { Action, PlayerView } from "@adventure/play-contract";
import type { Point } from "@adventure/game-core";
import type { StageExperience } from "@/components/play/v3/stage-play-screen";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import { chapterTasks } from "@/lib/demo/chapter-progress";
import { STORY_EXIT, storyExitLabels, RESISTANCE_DOORS } from "@/lib/demo/story-maps";
import { demoScenery, type DemoV3State } from "@/lib/demo/v3-session";
import { stages, sourceById } from "@/lib/demo/lim-bo-seng";
import { demoCinematics } from "@/lib/demo/cinematics";
import { DiscoveryRecord } from "./discovery-record";
import { objectDiscoveries, type DiscoveryId } from "@/lib/demo/discoveries";
import { buildResistanceInterior } from "@/lib/demo/resistance-interiors";
import { SourceQuestion } from "./source-question";
import { ChapterConsequence } from "./chapter-consequence";
import styles from "./waterfront-experience.module.css";

type Send = (action: Action, settled?: (ok: boolean) => void) => void;
export function useChapterExperience(
  getState: () => DemoV3State,
  restartKey: number,
  saveScope: string | null,
) {
  const [record, setRecord] = useState<
    DiscoveryId | "portraits" | "locked" | null
  >(null);
  const [seen, setSeen] = useState<number[]>([]);
  const [destination, setDestination] = useState<Point | null>(null);
  const [error, setError] = useState(false);
  const entering = useRef(false);
  const changingRoom = useRef(false);
  const approaching = useRef<string | null>(null);
  const [returnPoint, setReturnPoint] = useState<Point>({ x: 7, y: 10 });
  const lastStage = useRef(-1);
  const storageKey = saveScope ? `${saveScope}.two-chapter-consequences` : null;
  useEffect(() => {
    setRecord(null);
    setDestination(null);
    setError(false);
    entering.current = false;
    changingRoom.current = false;
    approaching.current = null;
    setReturnPoint({ x: 7, y: 10 });
    lastStage.current = -1;
    let saved: number[] = [];
    try {
      if (storageKey && restartKey) localStorage.removeItem(storageKey);
      const value = storageKey
        ? JSON.parse(localStorage.getItem(storageKey) || "[]")
        : [];
      if (Array.isArray(value))
        saved = value.filter(
          (n) => Number.isInteger(n) && n > 0 && n < stages.length,
        );
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
    const outside = state.room === "coast";
    const authored = outside
      ? { ...demoScenery[index].authored, playerSpawn: returnPoint }
      : buildResistanceInterior(state.room);
    const walkToDoor = (id: string) => {
      const door = RESISTANCE_DOORS.find((d) => d.id === id)!;
      approaching.current = id;
      setDestination({ x: door.point.x, y: door.point.y + 1 });
    };
    const changeRoom = (roomId: string) => {
      if (changingRoom.current) return;
      changingRoom.current = true;
      approaching.current = null;
      setDestination(null);
      const door = RESISTANCE_DOORS.find((d) => d.id === (outside ? roomId : state.room));
      if (door) setReturnPoint({ x: door.point.x, y: door.point.y + 1 });
      send({ type: "enterRoom", roomId }, (ok) => {
        changingRoom.current = false;
        setError(!ok);
        requestAnimationFrame(() => document.querySelector<HTMLCanvasElement>("canvas")?.focus());
      });
    };
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
      scenery: { authored, storyContext: outside ? "Perak coastal settlement" : "Illustrative Malayan resistance shelter", roomDescriptions: {} },
      destination,
      movementLocked: Boolean(record || showScene || state.open),
      hideDecision:
        Boolean(state.departureReady) ||
        tasks.some((t) => t.id !== "decision" && !t.done),
      decisionHint:
        "Make one recommendation, watch its consequence, then explore or walk through the exit.",
      mission: (
        <div className={styles.mission}>
          <p className={styles.dateline}>{outside ? chapter.place : view.rooms.find((r) => r.id === state.room)?.name}</p>
          <p>{outside ? "Enter a timber shelter to meet Lim, Tan or Tham. Each room holds different evidence." : "Speak with the person here and explore the evidence. The green mat leads back to the coast."}</p>
          <div className={styles.sceneControls}>
            {outside ? RESISTANCE_DOORS.map((door) => <button key={door.id} onClick={() => walkToDoor(door.id)}>Walk to {door.label}</button>)
              : <button onClick={() => setDestination({ x: 12, y: 14 })}>Walk outside</button>}
          </div>
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
              : "Three goals. Hover or walk close to reveal objects, then click to explore."}
          </p>
          <details className={styles.recordsMenu}>
            <summary>Optional discoveries</summary>
            <button onClick={() => setRecord("portraits")}>
              Photographs of the people you meet
            </button>
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
        else if (objectDiscoveries[id]) setRecord(objectDiscoveries[id]);
        else if (id === "resistance-room-exit") setDestination({ x: 12, y: 14 });
        else if (outside && RESISTANCE_DOORS.some((d) => `resistance-door-${d.id}` === id))
          walkToDoor(id.replace("resistance-door-", ""));
        else if (id === "chapter-exit") {
          if (ready) setDestination({ ...STORY_EXIT });
          else setRecord("locked");
        } else return false;
        return true;
      },
      onArrive(point) {
        if (!outside) {
          if ((point.x === 12 || point.x === 13) && point.y === 14) changeRoom("coast");
          return;
        }
        const target = RESISTANCE_DOORS.find((d) => d.id === approaching.current);
        if (target && point.x === target.point.x && point.y === target.point.y + 1) {
          approaching.current = null;
          setDestination({ ...target.point });
          return;
        }
        const door = RESISTANCE_DOORS.find((d) => point.y === d.point.y && point.x >= d.point.x && point.x <= d.point.x + 1);
        if (door) { changeRoom(door.id); return; }
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
                      {beat.id.endsWith("-lim") && <p>{sourceById("life").summary}</p>}
                      <SourceQuestion id={beat.id.endsWith("-lim") ? "life" : `${beat.id.split("-").at(-1)}-photo`} />
                    </figure>
                  ))}
              </div>
            </V3ScrollDialog>
          )}
          {record && record !== "locked" && record !== "portraits" && (
            <DiscoveryRecord id={record} onClose={close} />
          )}
        </>
      ),
    };
  };
}
