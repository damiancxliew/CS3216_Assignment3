"use client";
import { useEffect, useState } from "react";
import type { Action, PlayerView } from "@adventure/play-contract";
import type { Point } from "@adventure/game-core";
import type { StageExperience } from "@/components/play/v3/stage-play-screen";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import { BOARDING_POINT } from "@/lib/demo/waterfront-map";
import { type DemoV3State } from "@/lib/demo/v3-session";
import { stages } from "@/lib/demo/lim-bo-seng";
import styles from "./waterfront-experience.module.css";

const commitments = [
  {
    id: "food",
    name: "Household provisions",
    cost: "Someone must obtain and deliver supplies; setting aside a parcel does not guarantee continued access.",
  },
  {
    id: "care",
    name: "Care for the children",
    cost: "A named person needs time and support of their own. A promise is not the same as consent.",
  },
  {
    id: "contact",
    name: "Keep people informed",
    cost: "Communication takes time and involves other people in an uncertain situation.",
  },
  {
    id: "departure",
    name: "Departure preparations",
    cost: "Attention given to leaving is attention that cannot also go to every household need.",
  },
];
type Send = (action: Action, settled?: (ok: boolean) => void) => void;

/** Optional host UI for the authored opening. Ordinary v3 clients never mount it. */
export function useWaterfrontExperience(
  getState: () => DemoV3State,
  restartKey: number,
  saveScope: string | null,
) {
  const storageKey = saveScope ? `${saveScope}.waterfront` : null;
  const [activity, setActivity] = useState<
    "supplies" | "news" | "locked" | null
  >(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [checkedDate, setCheckedDate] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [boarding, setBoarding] = useState(false);
  const [destination, setDestination] = useState<Point | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (restartKey) localStorage.removeItem(storageKey);
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      setSelected(
        Array.isArray(saved.selected)
          ? saved.selected
              .filter((id: string) => commitments.some((c) => c.id === id))
              .slice(0, 2)
          : [],
      );
      setCheckedDate(saved.checkedDate === true);
    } catch {
      /* Optional exploration state; the main lesson still works. */
    }
    setActivity(null);
    setBoarding(false);
    setDestination(null);
  }, [restartKey, storageKey]);
  const save = (items: string[], date: boolean) => {
    setSelected(items);
    setCheckedDate(date);
    try {
      if (storageKey)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ selected: items, checkedDate: date }),
        );
    } catch {
      /* Keep this activity usable without storage. */
    }
  };
  return (view: PlayerView, send: Send): StageExperience | undefined => {
    if (view.stage?.index !== 0 || view.phase !== "stage") return;
    const state = getState();
    const ready = Boolean(state.departureReady);
    const choice = stages[0].choices.find(
      (c) => c.id === state.decisions.find((d) => d.stage === 0)?.choice,
    );
    const close = () => {
      setActivity(null);
      requestAnimationFrame(() =>
        document.querySelector<HTMLCanvasElement>("canvas")?.focus(),
      );
    };
    return {
      destination,
      movementLocked: activity !== null || boarding,
      hideDecision: ready,
      decisionHint:
        "Your recommendation opens the river steps. You can still explore before boarding.",
      onInspect(id) {
        if (id === "waterfront-supplies") {
          setActivity("supplies");
          return true;
        }
        if (id === "waterfront-news") {
          setActivity("news");
          return true;
        }
        if (id === "waterfront-exit") {
          if (ready) setDestination({ ...BOARDING_POINT });
          else setActivity("locked");
          return true;
        }
        return false;
      },
      onArrive(point) {
        if (
          ready &&
          point.x === BOARDING_POINT.x &&
          point.y === BOARDING_POINT.y
        ) {
          setDestination(null);
          setBoarding(true);
        }
      },
      mission: (
        <div className={styles.mission}>
          <p className={styles.dateline}>Singapore River · February 1942</p>
          <p className={styles.title}>
            {ready
              ? "The river steps are open"
              : "A household. A departure. Your recommendation."}
          </p>
          {ready ? (
            <>
              <p>
                Your choice is recorded. Walk to the green boarding sign beside
                the river.
              </p>
              <button
                className={styles.primary}
                onClick={() => setDestination({ ...BOARDING_POINT })}
              >
                Walk to the river steps →
              </button>
            </>
          ) : (
            <>
              <div className={styles.tasks}>
                <button onClick={() => setActivity("supplies")}>
                  {selected.length === 2 ? "✓" : "1"} Arrange household support
                </button>
                <button onClick={() => setActivity("news")}>
                  {checkedDate ? "✓" : "2"} Check the dated record
                </button>
                <span>
                  {view.notes.some((n) => n.stageIndex === 0) ? "✓" : "3"} Save
                  evidence and speak with Lim &amp; Gan
                </span>
              </div>
              <p>
                Click objects to investigate. The river steps open after your
                decision.
              </p>
            </>
          )}
        </div>
      ),
      overlay: (
        <>
          {activity && (
            <V3ScrollDialog
              title={
                activity === "supplies"
                  ? "Who keeps the household going?"
                  : activity === "news"
                    ? "A date changes what a source can tell you"
                    : "Before you board"
              }
              eyebrow="Singapore waterfront · explore"
              footerText="Explore · compare · make a recommendation"
              closeLabel="Return to the waterfront"
              onClose={close}
            >
              {activity === "supplies" ? (
                <div className={styles.activity}>
                  <p>
                    You can give detailed attention to two commitments. Select
                    them, then consider what your plan leaves unresolved.
                  </p>
                  <p className={styles.dateline}>
                    {selected.length} / 2 commitments selected · classroom
                    scenario
                  </p>
                  <div className={styles.cards}>
                    {commitments.map((c) => (
                      <button
                        key={c.id}
                        aria-pressed={selected.includes(c.id)}
                        disabled={
                          selected.length === 2 && !selected.includes(c.id)
                        }
                        onClick={() =>
                          save(
                            selected.includes(c.id)
                              ? selected.filter((id) => id !== c.id)
                              : [...selected, c.id],
                            checkedDate,
                          )
                        }
                      >
                        <strong>
                          {selected.includes(c.id) ? "✓ " : ""}
                          {c.name}
                        </strong>
                        <span>{c.cost}</span>
                      </button>
                    ))}
                  </div>
                  {selected.length === 2 && (
                    <div className={styles.feedback}>
                      <strong>What remains unresolved?</strong>
                      <p>
                        {commitments
                          .filter((c) => !selected.includes(c.id))
                          .map((c) => c.name)
                          .join(" and ")}{" "}
                        still need attention. Bring that trade-off to Lim or
                        Gan; use the family biography to distinguish evidence
                        from your proposed arrangement.
                      </p>
                    </div>
                  )}
                  <button className={styles.primary} onClick={close}>
                    Take this question back to the map
                  </button>
                </div>
              ) : activity === "news" ? (
                <div className={styles.activity}>
                  {/* The full archival image is evidence; it is not an illustration of departure. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- local archival photograph */}
                  <img
                    src="/demo/lim-bo-seng/surrender.png"
                    alt="British troops surrender in Singapore, 15 February 1942; AWM 127902"
                    className={styles.record}
                  />
                  <p>
                    <strong>Photograph date: 15 February 1942.</strong> Lim left
                    Singapore before the surrender. What can this photograph
                    establish?
                  </p>
                  <div className={styles.cards}>
                    {[
                      ["route", "The exact boat and quay Lim used to leave"],
                      ["context", "The surrender that followed his departure"],
                      ["family", "How his household felt when he left"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={answer === id}
                        onClick={() => {
                          setAnswer(id);
                          if (id === "context") save(selected, true);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {answer && (
                    <p className={styles.feedback}>
                      {answer === "context"
                        ? "Yes. It establishes surrender context, not Lim’s route or his family’s feelings. Now compare the family biography and the dated letter."
                        : "Look again at the date and what is visible. The image cannot establish Lim’s departure route or anyone’s private feelings."}
                    </p>
                  )}
                  <p className={styles.credit}>
                    Australian War Memorial · 127902 · public domain. Preserved
                    archival photograph.
                  </p>
                </div>
              ) : (
                <div className={styles.activity}>
                  <p>
                    Explore the household and records, save an evidence passage,
                    then make your recommendation. After your prediction, return
                    to these steps to leave.
                  </p>
                  <button className={styles.primary} onClick={close}>
                    Keep exploring
                  </button>
                </div>
              )}
            </V3ScrollDialog>
          )}
          {boarding && (
            <V3ScrollDialog
              title="A departure leaves people behind"
              eyebrow="Singapore · February 1942"
              footerText="Illustrative departure · continue when you are ready"
              closeLabel="Return to the quay"
              onClose={() => setBoarding(false)}
            >
              <div
                className={styles.departure}
                aria-label="Illustrated animation: Lim walks down the quay, boards a boat, and the boat leaves. Gan remains ashore."
              >
                <div className={styles.skyline} />
                <div className={styles.bank} />
                <div className={styles.river} />
                <span className={styles.gan} />
                <span className={styles.lim} />
                {choice?.id === "family" && <span className={styles.parcel} />}
                <span className={styles.boat} />
                <span className={styles.sceneLabel}>SINGAPORE RIVER</span>
              </div>
              <div className={styles.activity}>
                <p>
                  <strong>Your recommendation:</strong> {choice?.title}
                </p>
                <p>{choice?.outcome}</p>
                <p className={styles.credit}>
                  Illustrative transition, not Lim’s documented boarding place
                  or transport. The next scene moves forward to India in 1943;
                  the intervening journey is condensed.
                </p>
                <button
                  className={styles.primary}
                  onClick={() =>
                    send({ type: "enterRoom", roomId: "embark" }, (ok) => {
                      if (ok) setBoarding(false);
                    })
                  }
                >
                  Continue the journey · India, 1943 →
                </button>
              </div>
            </V3ScrollDialog>
          )}
        </>
      ),
    };
  };
}
