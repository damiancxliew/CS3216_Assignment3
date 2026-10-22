"use client";
import { useEffect, useRef, useState } from "react";
import type { Action, PlayerView } from "@adventure/play-contract";
import type { Point } from "@adventure/game-core";
import type { StageExperience } from "@/components/play/v3/stage-play-screen";
import { NoticeboardDialog } from "./evidence-dialog";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import {
  BOARDING_POINT,
  WATERFRONT_DOORS,
  buildWaterfrontMap,
} from "@/lib/demo/waterfront-map";
import { type DemoV3State } from "@/lib/demo/v3-session";
import {
  waterfrontTasks,
  atBoardingSteps,
} from "@/lib/demo/waterfront-progress";
import {
  WaterfrontRecord,
  type WaterfrontRecordId,
} from "./waterfront-records";
import { buildWaterfrontInterior } from "@/lib/demo/waterfront-interiors";
import { DiscoveryRecord } from "./discovery-record";
import { objectDiscoveries, type DiscoveryId } from "@/lib/demo/discoveries";
import { ARCHIVE_SHELVES } from "@/lib/demo/archive-shelves";
import { RickshawRide } from "./rickshaw-ride";
import { WaterfrontDeparture } from "./waterfront-departure";
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
  const [record, setRecord] = useState<WaterfrontRecordId | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryId | null>(null);
  const lastShelf = useRef<string | null>(null);
  const inSteps = useRef(false);
  const changingRoom = useRef(false);
  const approachingDoor = useRef<string | null>(null);
  const [returnPoint, setReturnPoint] = useState<Point>({ x: 4, y: 10 });
  const [riding, setRiding] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
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
    setRecord(null);
    setDiscovery(null);
    lastShelf.current = null;
    setAnswer(null);
    inSteps.current = false;
    setBoarding(false);
    setRiding(false);
    changingRoom.current = false;
    approachingDoor.current = null;
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
  const stageExperience = (
    view: PlayerView,
    send: Send,
  ): StageExperience | undefined => {
    if (view.stage?.index !== 0 || view.phase !== "stage") return;
    const state = getState();
    const outside = state.room === "street";
    const authored = outside
      ? {
          ...buildWaterfrontMap("departure", ["lim", "gan", "elizabeth"]),
          playerSpawn: returnPoint,
        }
      : buildWaterfrontInterior(state.room);
    const walkToDoor = (id: string) => {
      const door = WATERFRONT_DOORS.find((d) => d.id === id)!;
      approachingDoor.current = id;
      setDestination({ x: door.point.x, y: door.point.y + 1 });
    };
    const changeRoom = (roomId: string) => {
      if (changingRoom.current) return;
      changingRoom.current = true;
      approachingDoor.current = null;
      setDestination(null);
      setTransitionError(null);
      const door = WATERFRONT_DOORS.find((d) => d.id === (outside ? roomId : state.room));
      if (door) setReturnPoint({ x: door.point.x, y: door.point.y + 1 });
      send({ type: "enterRoom", roomId }, (ok) => {
        changingRoom.current = false;
        if (!ok)
          setTransitionError(
            "The doorway could not open. Step away and try again.",
          );
        requestAnimationFrame(() =>
          document.querySelector<HTMLCanvasElement>("canvas")?.focus(),
        );
      });
    };
    const tasks = waterfrontTasks(state);
    const missing = tasks.filter((task) => !task.done);
    const ready = missing.length === 0;
    const choice = stages[0].choices.find(
      (c) => c.id === state.decisions.find((d) => d.stage === 0)?.choice,
    );
    const close = () => {
      setActivity(null);
      setRecord(null);
      setDiscovery(null);
      requestAnimationFrame(() =>
        document.querySelector<HTMLCanvasElement>("canvas")?.focus(),
      );
    };
    const ActivityFrame = activity === "news" ? NoticeboardDialog : V3ScrollDialog;
    return {
      scenery: {
        authored,
        storyContext: outside
          ? "Singapore River street, February 1942"
          : "Illustrative Singapore shophouse interior",
        roomDescriptions: {},
      },
      destination,
      movementLocked:
        activity !== null || record !== null || discovery !== null || boarding || riding || Boolean(state.open),
      hideDecision:
        Boolean(state.departureReady) ||
        tasks.some((task) => task.id !== "decision" && !task.done),
      decisionHint:
        "Your recommendation opens the river steps. You can still explore before boarding.",
      onInspect(id) {
        const shelf = state.room === "records" && ARCHIVE_SHELVES.find((s) => s.id === id);
        if (shelf) {
          lastShelf.current = null;
          setDestination({ ...shelf.approach });
          return true;
        }
        if (objectDiscoveries[id]) {
          setDiscovery(objectDiscoveries[id]);
          return true;
        }
        const door = WATERFRONT_DOORS.find((d) => `door-${d.id}` === id);
        if (outside && door) {
          walkToDoor(door.id);
          return true;
        }
        if (id === "room-exit") {
          setDestination({ x: 12, y: 14 });
          return true;
        }
        if (id === "rickshaw") {
          setRiding(true);
          return true;
        }
        const records: Record<string, WaterfrontRecordId> = {
          "shop-record": "rickshaw",
          "shop-currency": "currency",
          "waterfront-newspaper": "newspaper",
        };
        if (records[id]) {
          setRecord(records[id]);
          return true;
        }
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
        const shelf = state.room === "records" && ARCHIVE_SHELVES.find((s) =>
          point.y === s.approach.y && point.x >= s.approach.x && point.x <= s.approach.x + 1);
        if (shelf && lastShelf.current !== shelf.id && !state.open) {
          lastShelf.current = shelf.id;
          setDestination(null);
          send({ type: "openDocument", documentId: shelf.sourceId });
          return;
        }
        if (!shelf) lastShelf.current = null;
        if (outside) {
          const approaching = WATERFRONT_DOORS.find(
            (d) => d.id === approachingDoor.current,
          );
          if (
            approaching &&
            point.x === approaching.point.x &&
            point.y === approaching.point.y + 1
          ) {
            approachingDoor.current = null;
            setDestination({ ...approaching.point });
            return;
          }
          const door = WATERFRONT_DOORS.find(
            (d) =>
              point.x >= d.point.x &&
              point.x <= d.point.x + 1 &&
              d.point.y === point.y,
          );
          if (door) {
            changeRoom(door.id);
            return;
          }
        } else {
          if ((point.x === 12 || point.x === 13) && point.y === 14)
            changeRoom("street");
          return;
        }
        const inside = atBoardingSteps(point);
        if (inside && !inSteps.current && !boarding) {
          setDestination(null);
          if (ready) setBoarding(true);
          else setActivity("locked");
        }
        inSteps.current = inside;
      },
      mission: (
        <div className={styles.mission}>
          <p className={styles.dateline}>
            {outside
              ? "Singapore River · February 1942"
              : state.room === "quay"
                ? "住家 · Inside the household"
                : state.room === "records"
                  ? "Later evidence · 1942–1943"
                  : "雜貨 · Inside the provision shop"}
          </p>
          {transitionError && <p role="alert">{transitionError}</p>}
          <p>
            {outside
              ? "Walk onto a green doorway: meet Lim in the provision shop or Gan at home. The evidence room looks ahead to occupation life."
              : state.room === "records"
                ? "Walk up to a yellow-outlined shelf folder to read its excerpt. Speak with Elizabeth, then use the green mat to return outside."
                : "Explore the room and speak with the person here. Walk onto the green mat at the bottom to return to the street."}
          </p>
          <div className={styles.sceneControls}>
            {outside ? (
              WATERFRONT_DOORS.map((door) => (
                <button key={door.id} onClick={() => walkToDoor(door.id)}>
                  Walk to {door.label}
                </button>
              ))
            ) : (
              <button onClick={() => setDestination({ x: 12, y: 14 })}>
                Walk outside
              </button>
            )}
          </div>
          <p className={styles.title}>
            {ready
              ? "The river steps are open"
              : "A household. A departure. Your recommendation."}
          </p>
          <div className={styles.tasks} aria-label="Before boarding checklist">
            {tasks.map((task, index) => (
              <span key={task.id}>
                {task.done ? "✓" : index + 1} {task.label}
              </span>
            ))}
          </div>
          <p>
            {ready
              ? "Walk onto the river steps to board automatically. Use WASD or the arrow keys; no boarding click needed."
              : "Follow these three steps, then walk to the boat. Everything under optional discoveries is yours to explore at your own pace."}
          </p>
          <details className={styles.recordsMenu}>
            <summary>Optional discoveries</summary>
            <p>
              These activities enrich the story; they do not block boarding.
            </p>
            {state.room === "quay" && (
              <button onClick={() => setActivity("supplies")}>
                {selected.length === 2 ? "✓ " : ""}Arrange household support
              </button>
            )}
            {outside && (
              <button onClick={() => setRiding(true)}>Ride the rickshaw</button>
            )}
            <button onClick={() => setActivity("news")}>
              {checkedDate ? "✓ " : ""}Check the dated record
            </button>
            <button onClick={() => setRecord("rickshaw")}>
              Rickshaw photograph
            </button>
            <button onClick={() => setRecord("newspaper")}>
              Newspaper board · 20 February 1942
            </button>
            <button onClick={() => setRecord("currency")}>
              Occupation currency
            </button>
          </details>
        </div>
      ),
      overlay: (
        <>
          {discovery && <DiscoveryRecord id={discovery} onClose={close} />}
          {riding && (
            <RickshawRide
              onClose={() => {
                setRiding(false);
                requestAnimationFrame(() =>
                  document.querySelector<HTMLCanvasElement>("canvas")?.focus(),
                );
              }}
            />
          )}
          {record && (
            <WaterfrontRecord key={record} id={record} onClose={close} />
          )}
          {activity && (
            <ActivityFrame
              title={
                activity === "supplies"
                  ? "Who keeps the household going?"
                  : activity === "news"
                    ? "A date changes what a source can tell you"
                    : "Before you board"
              }
              eyebrow="Singapore waterfront · explore"
              footerText="Explore · compare · make a recommendation"
              closeLabel="Return to exploring"
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
                  <p className={styles.credit} data-record-credit>
                    Australian War Memorial · 127902 · public domain. Preserved
                    archival photograph.
                  </p>
                </div>
              ) : (
                <div className={styles.activity}>
                  <p>The boat waits until you have finished these tasks:</p>
                  <ul>
                    {missing.map((task) => (
                      <li key={task.id}>{task.label}</li>
                    ))}
                  </ul>
                  <p>
                    When every task is complete, walk back onto the steps to
                    board automatically.
                  </p>
                  <button className={styles.primary} onClick={close}>
                    Keep exploring
                  </button>
                </div>
              )}
            </ActivityFrame>
          )}
          {boarding && choice && (
            <WaterfrontDeparture
              choice={choice}
              send={send}
              onClose={() => {
                setBoarding(false);
                requestAnimationFrame(() =>
                  document.querySelector<HTMLCanvasElement>("canvas")?.focus(),
                );
              }}
            />
          )}
        </>
      ),
    };
  };
  return stageExperience;
}
