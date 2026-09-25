"use client";

/**
 * The playable view over the Turn API. Everything on the right-hand panel is
 * reachable by keyboard and works with the canvas ignored (Y5); the map is the
 * spatial layer on top of the same state, not a second source of truth.
 *
 * The panel is a HUD with one focal point. Top: where you are and where you can
 * go (compact). Middle: the conversation, which is the game, so it takes the
 * height. Bottom, always visible: your goals as a progress strip and the
 * decision, which stays quiet until you can actually make it, then lights up.
 * Sized for a 13-year-old on a school laptop: 16px base, 44px targets.
 */
import { ArrowRight, Check, Compass, CornerDownRight, DoorOpen, Flag, HelpCircle, Lock, MapPin, ScrollText, Timer, UserRound, Volume2, VolumeX } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { canHearSpeech, findPath, isInPhysicalInteractionRange, isWalkable, spaceAt, type DoorState, type Point, type StageMap } from "@adventure/game-core";
import { playApi } from "./api";
import type { MapIntent } from "./map-canvas";
import { stageMusicUrl, useSoundCues, useStageMusic } from "./sound";
import { completeWalkthrough, restartAttempt } from "@/app/play/[attemptId]/actions";
import { StageCountdown } from "@/components/stage-countdown";
import { Pending, Spinner, Thinking } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";
import { historicalPortraitFor } from "@/lib/play/historical-portraits";
import { withSceneBreaks } from "@/lib/play/transcript";
import { DocumentReader } from "./document-reader";
import { AdventureDialog } from "./adventure-dialog";
import { StageCutscene } from "./stage-cutscene";
import styles from "./adventure-chrome.module.css";
import roomStyles from "./room-panel.module.css";
import { RoomActions } from "./room-actions";
import { GameWalkthrough } from "./game-walkthrough";

const MapCanvas = dynamic(() => import("./map-canvas").then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-world-wash" role="status">
      <span className="inline-flex items-center gap-2 rounded-control bg-surface px-4 py-2.5 text-base font-semibold text-ink">
        <Spinner /> Loading the map…
      </span>
    </div>
  ),
});

const POLL_MS = 8_000;
const IDLE_POLL_MS = 30_000;
/** The controls hint belongs to the first seconds of a stage, not to the whole game. */
const HINT_MS = 7_000;
/** A failing server is not polled at the same rate: back off, and give up rather than pile on. */
const MAX_POLL_MS = 120_000;
const GIVE_UP_AFTER = 6;

type Landmark = PlayState["landmarks"][number];

function landmarkDistance(point: Point, landmark: Landmark): number {
  const dx = Math.max(landmark.position.x - point.x, 0, point.x - landmark.position.x - landmark.width + 1);
  const dy = Math.max(landmark.position.y - point.y, 0, point.y - landmark.position.y - landmark.height + 1);
  return dx + dy;
}

function landmarkApproach(state: PlayState, landmark: Landmark, from: Point | null): Point | null {
  if (!state.map || !from) return null;
  const map = state.map as StageMap;
  const room = map.rooms.find((candidate) => candidate.id === landmark.roomId);
  if (!room) return null;
  const doors: Record<string, DoorState> = Object.fromEntries(map.doors.map((door) => [door.id, state.rooms.find((room) => room.id === door.roomId)?.doorOpen ? "open" : "closed"]));
  const candidates: { point: Point; distance: number }[] = [];
  for (let y = landmark.position.y - 1; y <= landmark.position.y + landmark.height; y += 1) {
    for (let x = landmark.position.x - 1; x <= landmark.position.x + landmark.width; x += 1) {
      const point = { x, y };
      if (landmarkDistance(point, landmark) !== 1 || !isWalkable(map, doors, point)
        || point.x <= room.x || point.x >= room.x + room.width - 1
        || point.y <= room.y || point.y >= room.y + room.height - 1) continue;
      const route = findPath(map, doors, from, point);
      if (route) candidates.push({ point, distance: route.length });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.point ?? null;
}

function localRoomId(state: PlayState, position: Point | null): string | null {
  if (!state.map || !position) return null;
  const space = spaceAt(state.map as StageMap, position);
  return space?.kind === "room" ? space.roomId : space?.kind === "outdoor" ? space.locationId ?? null : null;
}

function localCanInspect(state: PlayState, position: Point | null, propId: string): boolean {
  const prop = state.props.find((item) => item.id === propId);
  if (!state.map || !position || !prop) return false;
  const doors: Record<string, "open" | "closed"> = Object.fromEntries(state.map.doors.map((door) => [door.id, state.rooms.find((room) => room.id === door.roomId)?.doorOpen ? "open" : "closed"]));
  return isInPhysicalInteractionRange(state.map as StageMap, doors, position, prop.position);
}

/** Generated identity art, with a sober monogram while generation is pending or filtered. */
function Portrait({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const imageSrc = [src, historicalPortraitFor(name)].find((url) => url && !failedUrls.includes(url));
  const box = { width: size, height: size, minWidth: size, minHeight: size };
  if (!imageSrc) {
    const monogram = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center self-start rounded-control border border-line bg-inverse font-serif text-on-inverse"
        style={box}
        role="img"
        aria-label={`${name}'s identity marker`}
      >
        {monogram}
      </span>
    );
  }
  const pixel = imageSrc.startsWith("/game/ninja/");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage urls are dynamic and the facesets are tiny
    <img
      src={imageSrc}
      onError={() => setFailedUrls((urls) => [...urls, imageSrc])}
      alt={`${name}'s portrait`}
      width={size}
      height={size}
      className="shrink-0 self-start rounded-control border border-line bg-[#e7d4a8] object-cover"
      style={{ ...box, imageRendering: pixel ? "pixelated" : undefined }}
    />
  );
}

const chip =
  `${styles.chip} inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3.5 py-2 text-base font-semibold leading-tight text-ink transition-colors hover:border-ink disabled:opacity-60`;
const primary =
  `${styles.primary} inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-4 py-2 text-base font-semibold leading-snug text-paper transition-colors hover:bg-record disabled:opacity-60`;
const subtle =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-line-strong bg-transparent px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-60";
const label = "text-sm font-semibold text-muted";

export function PlayClient({
  attemptId,
  initialState,
  retriesAllowed,
  walkthroughSeen,
}: {
  attemptId: string;
  initialState: PlayState;
  retriesAllowed: boolean;
  walkthroughSeen: { mobile: boolean; desktop: boolean };
}) {
  const router = useRouter();
  const [state, setState] = useState<PlayState>(initialState);
  const stateRef = useRef(initialState);
  const [localPosition, setLocalPosition] = useState<{ stageId: string; point: Point | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingSpeech, setPendingSpeech] = useState<{ id: string; roomId: string; body: string } | null>(null);
  const [intent, setIntent] = useState<MapIntent>(null);
  const [pendingTalk, setPendingTalk] = useState<string | null>(null);
  const [goalHintLevels, setGoalHintLevels] = useState<Record<string, number>>({});
  const [lastResolution, setLastResolution] = useState<string | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decidingOption, setDecidingOption] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [loadingDocuments, setLoadingDocuments] = useState<string[]>([]);
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({});
  const readingRequests = useRef(new Set<string>());
  const [inspectingLandmark, setInspectingLandmark] = useState<string | null>(null);
  const [pendingLandmark, setPendingLandmark] = useState<string | null>(null);
  const [pendingRead, setPendingRead] = useState<string | null>(null);
  const [cutsceneOpen, setCutsceneOpen] = useState(initialState.status === "active" && initialState.revision === 0);
  const [layout, setLayout] = useState<"mobile" | "desktop" | null>(null);
  const [seen, setSeen] = useState(walkthroughSeen);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setLayout(query.matches ? "mobile" : "desktop");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!cutsceneOpen && layout && !seen[layout] && state.status === "active") setWalkthroughOpen(true);
  }, [cutsceneOpen, layout, seen, state.status]);
  const finishWalkthrough = useCallback(async (completedLayout: "mobile" | "desktop") => {
    try {
      const result = await completeWalkthrough(completedLayout);
      if (!result.ok) return false;
      setSeen((current) => ({ ...current, [completedLayout]: true }));
      setWalkthroughOpen(false);
      return true;
    } catch { return false; }
  }, []);
  const [hintVisible, setHintVisible] = useState(true);
  const transcriptLog = useRef<HTMLDivElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const readRef = useRef<(evidenceId: string, open?: boolean) => void>(() => {});
  const autoReadAt = useRef<string | null>(null);
  const revision = useRef(initialState.revision);
  const serverViewKey = useRef(`${initialState.stage.id}:${initialState.status}`);
  const previousStageId = useRef(initialState.stage.id);
  const { muted, toggleMuted, cues } = useSoundCues(state, notice);
  // The map renderer is rebuilt on every stage; the soundtrack is not, so it crossfades instead of stacking.
  useStageMusic(stageMusicUrl(state), muted);

  useEffect(() => {
    const key = `${state.stage.id}:${state.status}`;
    if (key === serverViewKey.current) return;
    serverViewKey.current = key;
    router.refresh();
  }, [router, state.stage.id, state.status]);

  useEffect(() => {
    if (state.pendingDialogue && pendingSpeech) setPendingSpeech(null);
  }, [pendingSpeech, state.pendingDialogue]);

  useEffect(() => {
    if (!hintVisible) return;
    const timer = window.setTimeout(() => setHintVisible(false), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hintVisible]);

  const accept = useCallback((next: PlayState) => {
    // Out-of-order replies are discarded (I3: revision is monotonic per attempt).
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    stateRef.current = next;
    setState(next);
  }, []);
  const visiblePosition = localPosition?.stageId === state.stage.id ? localPosition.point : state.playerPos;

  const [offline, setOffline] = useState(false);
  const [mintAttempt, setMintAttempt] = useState(0);

  // One writer at a time: the map can settle a position while a room entry is still
  // in flight, and the server rejects the second write as a conflict it caused itself.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const serialize = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const failures = useRef(0);
  const mintInFlight = useRef(false);
  const mintFailureKey = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await playApi.state(attemptId);
    if (result.ok) {
      failures.current = 0;
      setOffline(false);
      accept(result.body);
    } else {
      failures.current += 1;
    }
    return result.ok;
  }, [attemptId, accept]);

  useEffect(() => {
    let timer = 0;
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "visible" && !busyRef.current) await refresh();
      if (failures.current >= GIVE_UP_AFTER) setOffline(true);
      if (cancelled || failures.current >= GIVE_UP_AFTER) return;
      const interval = stateRef.current.pendingDialogue || stateRef.current.mintReady ? POLL_MS : IDLE_POLL_MS;
      const delay = Math.min(interval * 2 ** failures.current, MAX_POLL_MS);
      const deadline = stateRef.current.timer.deadlineAt && failures.current === 0
        ? Math.max(1_000, new Date(stateRef.current.timer.deadlineAt).getTime() - Date.now() + 250)
        : delay;
      timer = window.setTimeout(tick, Math.min(deadline, delay));
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!state.mintReady || state.status !== "active" || mintInFlight.current) return;
    const failureKey = `${attemptId}:${state.stage.id}:${state.revision}`;
    if (mintFailureKey.current === failureKey) return;
    mintInFlight.current = true;
    void playApi.mint(attemptId)
      .then((result) => {
        if (!result.ok) {
          mintFailureKey.current = failureKey;
          void refresh();
          return;
        }
        mintFailureKey.current = null;
        accept(result.body.state);
      })
      .catch(() => {
        mintFailureKey.current = failureKey;
        void refresh();
      })
      .finally(() => {
        mintInFlight.current = false;
        const current = stateRef.current;
        const currentKey = `${attemptId}:${current.stage.id}:${current.revision}`;
        if (current.mintReady && current.status === "active" && mintFailureKey.current !== currentKey) setMintAttempt((value) => value + 1);
      });
  }, [accept, attemptId, mintAttempt, refresh, state.mintReady, state.revision, state.stage.id, state.status]);

  useEffect(() => {
    const log = transcriptLog.current;
    const latest = transcriptEnd.current?.previousElementSibling;
    if (!log) return;

    // Keep the beginning of an unusually tall new reply visible. Aligning the
    // end marker unconditionally can hide its first lines in a short viewport.
    if (latest instanceof HTMLElement && latest.offsetHeight > log.clientHeight) {
      const logTop = log.getBoundingClientRect().top;
      const latestTop = latest.getBoundingClientRect().top;
      log.scrollTop += latestTop - logTop;
      return;
    }
    log.scrollTop = log.scrollHeight;
    // A room change appends a divider without appending a line, so it scrolls too.
  }, [state.transcript.length, state.currentRoomId, pendingSpeech?.id, busy]);

  // The moment a choice becomes possible, show it; a new stage closes it again.
  const canDecide = state.options.some((o) => o.available);
  useEffect(() => {
    setDecisionOpen(canDecide);
    if (previousStageId.current === state.stage.id) return;
    previousStageId.current = state.stage.id;
    setIntent(null);
    setPendingTalk(null);
    setPendingRead(null);
    setPendingLandmark(null);
    setInspectingLandmark(null);
    setReading(null);
    setNotesOpen(false);
    setAccountsOpen(false);
    setLoadingDocuments([]);
    setDocumentErrors({});
    setDraft("");
    setNotice(null);
    setCutsceneOpen(true);
  }, [canDecide, state.stage.id]);

  const here = state.rooms.find((r) => r.id === state.currentRoomId) ?? null;
  const peopleHere = state.agents.filter((agent) => {
    const actor = state.actors.find((candidate) => candidate.id === agent.id);
    return state.map && visiblePosition && actor?.position
      ? canHearSpeech(state.map as StageMap, visiblePosition, actor.position)
      : state.hearingActorIds.includes(agent.id);
  });
  const canSendToRoom = peopleHere.some((person) => state.hearingActorIds.includes(person.id));
  const waitingDoor = state.map?.doors.find((door) => state.playerPos?.x === door.outside.x && state.playerPos.y === door.outside.y && state.rooms.find((room) => room.id === door.roomId)?.doorOpen === false);
  const waitingRoom = waitingDoor ? state.rooms.find((room) => room.id === waitingDoor.roomId) : null;
  const items = withSceneBreaks(state.transcript, {
    currentRoomId: state.currentRoomId,
    roomName: (roomId) => state.rooms.find((room) => room.id === roomId)?.name ?? "the open air",
    actorName: (actorId) => state.agents.find((agent) => agent.id === actorId)?.name ?? "someone else",
  });

  async function act(label: string, run: () => Promise<{ ok: true; body: { state: PlayState; refused?: string | null } } | { ok: false; error: { message: string } }>) {
    setBusy(label);
    setNotice(null);
    try {
      const result = await serialize(run);
      if (!result.ok) {
        setNotice(result.error.message);
        await refresh();
        return false;
      }
      accept(result.body.state);
      if (result.body.refused) setNotice(result.body.refused);
      return !result.body.refused;
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const current = stateRef.current;
    const body = draft.trim();
    const roomId = current.currentRoomId;
    if (!body || !roomId || !canSendToRoom || busy !== null || speaking || current.pendingDialogue) return;
    setDraft("");
    setPendingSpeech({ id: crypto.randomUUID(), roomId, body });
    setSpeaking(true);
    setNotice(null);
    try {
      const result = await playApi.message(attemptId, { roomId, body, addresseeId: null });
      if (!result.ok) {
        setDraft((value) => (value === "" ? body : value));
        setNotice(result.error.message);
        await refresh();
      } else accept(result.body.state);
    } finally {
      setPendingSpeech(null);
      setSpeaking(false);
    }
  }

  async function decide(optionId: string) {
    setBusy("Deciding…");
    setDecidingOption(optionId);
    setNotice(null);
    try {
      const result = await serialize(() => playApi.decide(attemptId, { optionId, optionsVersion: state.optionsVersion }));
      if (!result.ok) {
        setNotice(result.error.message);
        await refresh();
        return;
      }
      setLastResolution(result.body.resolution.announcement);
      accept(result.body.state);
    } finally {
      setBusy(null);
      setDecidingOption(null);
    }
  }

  const onSteps = useCallback(
    async (from: Point, path: Point[]) => {
      const before = stateRef.current;
      if (before.status !== "active" || busy === "Deciding…" || busy === "Knocking…") return { position: before.playerPos, accepted: false, retry: false };
      const failPickup = () => {
        const ids = before.props.filter((prop) => !prop.found && path.some((point) => point.x === prop.position.x && point.y === prop.position.y)).map((prop) => prop.id);
        if (!ids.length) return;
        setPendingRead((current) => current && ids.includes(current) ? null : current);
        setDocumentErrors((errors) => ({ ...errors, ...Object.fromEntries(ids.map((id) => [id, "Couldn’t pick up this scroll. Move closer and try again."])) }));
      };
      setHintVisible(false);
      try {
        let requestSentAt = 0;
        const result = await serialize(() => {
          requestSentAt = performance.now();
          return playApi.action(attemptId, { type: "move_steps", stageId: before.stage.id, from, path });
        });
        const acknowledgedAt = performance.now();
        if (!result.ok) {
          if (result.error.code === "rate_limited") {
            return { position: stateRef.current.playerPos, accepted: false, retry: true, timings: result.timings, requestSentAt, acknowledgedAt };
          }
          if (result.error.code === "stale_state") {
            await refresh();
            if (stateRef.current.playerPos?.x !== from.x || stateRef.current.playerPos?.y !== from.y) failPickup();
            return { position: stateRef.current.playerPos, accepted: false, retry: true, timings: result.timings, requestSentAt, acknowledgedAt };
          }
          failPickup();
          setNotice(result.error.message);
          await refresh();
          return { position: stateRef.current.playerPos, accepted: false, retry: false, timings: result.timings, requestSentAt, acknowledgedAt };
        }
        accept(result.body.state);
        if (result.body.refused) { failPickup(); setNotice(result.body.refused); }
        return { position: stateRef.current.playerPos, accepted: !result.body.refused && stateRef.current.stage.id === before.stage.id, retry: false, timings: result.timings, requestSentAt, acknowledgedAt };
      } catch {
        failPickup();
        setNotice("Could not reach the server. Please try again.");
        return { position: stateRef.current.playerPos, accepted: false, retry: false };
      }
    },
    [attemptId, accept, refresh, busy, serialize],
  );

  // From the map: walk into speaking range and focus the room composer.
  const onTalk = useCallback((actorId: string) => {
    setHintVisible(false);
    setReading(null);
    const current = stateRef.current;
    const point = localPosition?.stageId === current.stage.id ? localPosition.point : current.playerPos;
    const target = current.actors.find((actor) => actor.id === actorId)?.position;
    if (!current.map || !point || !target || !canHearSpeech(current.map as StageMap, point, target)) {
      setPendingTalk(actorId);
      if (target) setIntent({ kind: "point", point: target });
      return;
    }
    setPendingTalk(current.hearingActorIds.includes(actorId) ? null : actorId);
    composer.current?.focus();
    composer.current?.scrollIntoView({ block: "nearest" });
  }, [localPosition]);

  // Stop as soon as the selected person is within speaking range; occupying their tile is neither
  // necessary nor possible because actors collide.
  useEffect(() => {
    if (!pendingTalk) return;
    const target = state.actors.find((actor) => actor.id === pendingTalk)?.position;
    const inRange = state.map && visiblePosition && target && canHearSpeech(state.map as StageMap, visiblePosition, target);
    if (!inRange) return;
    if (state.hearingActorIds.includes(pendingTalk)) setPendingTalk(null);
    if (inRange) setIntent(null);
    composer.current?.focus();
    composer.current?.scrollIntoView({ block: "nearest" });
  }, [pendingTalk, state, visiblePosition]);

  /** Examine a document, then put it in front of the player to read. */
  async function read(evidenceId: string, open = true) {
    if (open) setReading(evidenceId);
    const known = stateRef.current.journal.some((entry) => entry.id === evidenceId);
    if (known || readingRequests.current.has(evidenceId)) return;
    readingRequests.current.add(evidenceId);
    setLoadingDocuments((ids) => ids.includes(evidenceId) ? ids : [...ids, evidenceId]);
    setDocumentErrors((errors) => ({ ...errors, [evidenceId]: "" }));
    try {
      const ok = await act("Reading…", () => {
        // A queued movement may have collected it while this request was waiting.
        if (stateRef.current.journal.some((entry) => entry.id === evidenceId)) return Promise.resolve({ ok: true as const, body: { state: stateRef.current } });
        return playApi.action(attemptId, { type: "inspect", evidenceId });
      });
      if (!ok) setDocumentErrors((errors) => ({ ...errors, [evidenceId]: "Couldn’t open this scroll. Move closer and try again." }));
    } catch {
      setDocumentErrors((errors) => ({ ...errors, [evidenceId]: "Couldn’t load this scroll. Please try again." }));
    } finally {
      readingRequests.current.delete(evidenceId);
    }
  }
  readRef.current = (evidenceId, open) => { void read(evidenceId, open); };

  function onPickup(evidenceId: string) {
    setIntent(null);
    setReading(evidenceId);
    setPendingRead(evidenceId);
    setLoadingDocuments((ids) => ids.includes(evidenceId) ? ids : [...ids, evidenceId]);
  }

  /** From the map: read the document if you are next to it, otherwise walk over first. */
  function onProp(propId: string) {
    setHintVisible(false);
    const current = stateRef.current;
    const point = localPosition?.stageId === current.stage.id ? localPosition.point : current.playerPos;
    if (current.journal.some((entry) => entry.id === propId) || (localCanInspect(current, point, propId) && current.evidenceHere.some((item) => item.id === propId && item.canInspect))) {
      setPendingRead(null);
      void read(propId);
      return;
    }
    const prop = current.props.find((item) => item.id === propId);
    if (prop) {
      setPendingRead(propId);
      if (localCanInspect(current, point, propId)) {
        setIntent(null);
        setReading(propId);
      }
      else setIntent({ kind: "point", point: prop.position });
    }
  }

  function onLandmark(landmarkId: string) {
    setHintVisible(false);
    const current = stateRef.current;
    const landmark = current.landmarks.find((item) => item.id === landmarkId);
    if (!landmark) return;
    const point = localPosition?.stageId === current.stage.id ? localPosition.point : current.playerPos;
    if (point && localRoomId(current, point) === landmark.roomId && landmarkDistance(point, landmark) === 1) {
      setPendingLandmark(null);
      setInspectingLandmark(landmarkId);
      return;
    }
    setPendingLandmark(landmarkId);
    setIntent(localRoomId(current, point) !== landmark.roomId && current.currentRoomId !== landmark.roomId ? { kind: "room", roomId: landmark.roomId } : null);
  }

  useEffect(() => {
    if (!pendingLandmark) return;
    const landmark = state.landmarks.find((item) => item.id === pendingLandmark);
    if (!landmark) {
      setPendingLandmark(null);
    } else if (localRoomId(state, visiblePosition) === landmark.roomId || state.currentRoomId === landmark.roomId) {
      if (visiblePosition && landmarkDistance(visiblePosition, landmark) === 1) {
        setPendingLandmark(null);
        setIntent(null);
        setInspectingLandmark(landmark.id);
      } else {
        const point = landmarkApproach(state, landmark, visiblePosition);
        if (point) setIntent((current) => current?.kind === "point" ? current : { kind: "point", point });
      }
    }
  }, [pendingLandmark, state, visiblePosition]);

  // A map click is one action: after the walk reaches inspection range, finish it by opening
  // the document instead of requiring a second click on the same prop.
  useEffect(() => {
    if (!pendingRead || busy !== null) return;
    const current = stateRef.current;
    const nearby = localCanInspect(current, visiblePosition, pendingRead);
    const readable = current.journal.some((entry) => entry.id === pendingRead)
      || nearby && current.evidenceHere.some((item) => item.id === pendingRead && item.canInspect);
    if (nearby) {
      setIntent(null);
      setReading(pendingRead);
    } else if (!readable) {
      setReading((open) => open === pendingRead ? null : open);
    }
    if (readable) {
      setPendingRead(null);
      setIntent(null);
      readRef.current(pendingRead, !loadingDocuments.includes(pendingRead));
    } else if (!current.props.some((item) => item.id === pendingRead)) {
      setPendingRead(null);
    }
  }, [pendingRead, state.revision, busy, loadingDocuments, visiblePosition]);

  // Walking directly over a document picks it up even when movement did not begin from its label.
  useEffect(() => {
    if (busy !== null || !state.playerPos) return;
    const atFeet = state.props.find((item) => !item.found && item.position.x === state.playerPos?.x && item.position.y === state.playerPos?.y);
    if (!atFeet) {
      autoReadAt.current = null;
      return;
    }
    const pickupKey = `${state.stage.id}:${atFeet.id}:${state.playerPos.x},${state.playerPos.y}`;
    if (autoReadAt.current === pickupKey) return;
    autoReadAt.current = pickupKey;
    setPendingRead(null);
    setIntent(null);
    readRef.current(atFeet.id);
  }, [busy, state.playerPos, state.props, state.stage.id]);

  const openLandmark = inspectingLandmark ? state.landmarks.find((item) => item.id === inspectingLandmark) ?? null : null;
  const pendingDocuments = loadingDocuments.filter((id) => !state.journal.some((entry) => entry.id === id) && state.props.some((prop) => prop.id === id));
  const collectedDocuments = [...state.journal.map((entry) => entry.id), ...pendingDocuments].map((id) => ({
    id,
    name: state.props.find((prop) => prop.id === id)?.name ?? state.journal.find((entry) => entry.id === id)?.text.split(": ")[0] ?? "Document",
  }));
  const activeDocumentId = reading ?? (notesOpen ? collectedDocuments.at(-1)?.id ?? null : null);
  const openDocument = state.journal.find((entry) => entry.id === activeDocumentId) ?? null;
  const preparedDocument = state.evidenceHere.find((item) => item.id === activeDocumentId && item.canInspect)?.content ?? null;
  const openDocumentName = collectedDocuments.find((item) => item.id === activeDocumentId)?.name
    ?? state.props.find((item) => item.id === activeDocumentId)?.name ?? "Document";

  if (state.status === "completed") {
    return (
      <section className={`${styles.game} mx-auto my-10 flex w-full max-w-2xl flex-col gap-5 px-6`}>
        {/* The map (and its sound manager) is gone at the ending; the closing theme plays from here. */}
        {!muted ? <audio src="/game/ninja/audio/music/end-theme.ogg" autoPlay loop /> : null}
        <p className={label}>The end</p>
        <h2 className="font-serif text-4xl text-ink">{state.ending?.title ?? "The adventure is over"}</h2>
        {lastResolution ? <p className="text-lg leading-relaxed text-ink">{lastResolution}</p> : null}
        {state.ending ? <p className="text-lg leading-relaxed text-muted">{state.ending.summary}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link href={`/play/${attemptId}/debrief`} className={`${primary} min-h-12 px-6 text-lg`}>
            Read the debrief
          </Link>
          {retriesAllowed ? (
            <button
              type="button"
              className={`${chip} min-h-12 px-5`}
              disabled={busy !== null}
              onClick={async () => {
                setBusy("Starting again…");
                setNotice(null);
                const result = await restartAttempt(attemptId);
                if (!result.ok) {
                  setNotice(result.error);
                  setBusy(null);
                  return;
                }
                router.push(`/play/${result.attemptId}`);
              }}
            >
              {busy === "Starting again…" ? <Pending>Starting again…</Pending> : "Play it again"}
            </button>
          ) : null}
          <Link href="/" className={`${subtle} min-h-12 px-5 text-base`}>
            Leave for the home page
          </Link>
        </div>
        {notice ? (
          <p role="alert" className="rounded-control border border-danger/50 bg-danger-wash px-3.5 py-2.5 text-base text-ink">
            {notice}
          </p>
        ) : null}
      </section>
    );
  }

  const goalsMet = state.stage.objectives.filter((o) => o.met).length;
  const goalsTotal = state.stage.objectives.length;
  const decided = state.commitments.filter((c) => c.committed).length;
  const lowTime = state.timer.enabled && state.timer.secondsRemaining !== null && state.timer.secondsRemaining <= 120;

  return (
    <div className={`${styles.game} flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row`}>
      {cutsceneOpen ? <StageCutscene state={state} onBegin={() => setCutsceneOpen(false)} /> : null}
      {walkthroughOpen && !cutsceneOpen && layout ? <GameWalkthrough layout={layout} onClose={finishWalkthrough} /> : null}

      <section data-walkthrough="map" className="relative h-[32dvh] min-h-[11rem] shrink-0 bg-sunken lg:h-auto lg:min-h-0 lg:flex-1" aria-label="Map">
        <MapCanvas
          state={state}
          audio={{ muted, cues }}
          intent={intent}
          onIntentDone={() => setIntent(null)}
          onSteps={onSteps}
          onLocalPosition={(point) => setLocalPosition({ stageId: stateRef.current.stage.id, point })}
          onTalk={onTalk}
          onProp={onProp}
          onPickup={onPickup}
          onLandmark={onLandmark}
        />
        {hintVisible ? (
          <p className="pointer-events-none absolute left-3 right-3 top-3 rounded-control bg-inverse/85 px-3 py-1.5 text-sm font-semibold text-on-inverse lg:px-3.5 lg:py-2 lg:text-base">
            <span className="lg:hidden">Tap to walk; tap a person, document, or landmark to interact.</span>
            <span className="hidden lg:inline">
              Use arrows or WASD to walk. Click a person, document, or landmark to interact; press Enter to talk.
            </span>
          </p>
        ) : null}
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2" role="group" aria-label="Adventure tools">
          <button
            data-walkthrough="tools"
            type="button"
            onClick={() => setNotesOpen(true)}
            aria-haspopup="dialog"
            className={`${styles.tool} inline-flex min-h-11 items-center gap-2 px-3 py-2 text-base font-semibold`}
          >
            <ScrollText className="h-5 w-5" aria-hidden />
            Notes ({collectedDocuments.length})
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWalkthroughOpen(true)}
              aria-label="How to play"
              className={`${styles.tool} inline-flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold`}
            >
              <HelpCircle className="h-5 w-5" aria-hidden />
              <span className="sm:hidden">Help</span><span className="hidden sm:inline">How to play</span>
            </button>
            <button
              type="button"
              onClick={toggleMuted}
              aria-pressed={muted}
              className={`${styles.tool} inline-flex min-h-11 items-center gap-2 px-3 py-2 text-base font-semibold lg:px-3.5`}
            >
              {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
              <span className="sr-only sm:not-sr-only">{muted ? "Sound off" : "Sound on"}</span>
            </button>
          </div>
        </div>
        {lastResolution ? (
          <div
            role="status"
            className={`${styles.resolution} absolute inset-x-3 top-3 mx-auto max-h-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto p-4 text-ink sm:p-5`}
          >
            <p className="mb-2 text-base font-semibold text-world">What happened</p>
            <p className="leading-relaxed sm:text-lg">{lastResolution}</p>
            <button type="button" className={`${primary} mt-4`} onClick={() => setLastResolution(null)}>
              Got it
            </button>
          </div>
        ) : null}
      </section>

      <aside className={`${styles.panel} flex min-h-0 w-full min-w-0 shrink-0 flex-col text-base lg:w-[min(42rem,48vw)]`}>
        {/* ── Top: where you are, where you can go ─────────────────────────── */}
        <section className={`${styles.where} flex shrink-0 flex-col gap-3 px-5 py-4`} aria-labelledby="where">
          <div className={roomStyles.roleLine}>
            <span>You are playing <strong className="text-ink">{state.player.role}</strong></span>
            <button type="button" onClick={() => setCutsceneOpen(true)} aria-label={`Open your role brief: ${state.player.role}`}>Read role brief</button>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={styles.locationLabel}><MapPin size={14} aria-hidden /> You are here</p>
              <h2 id="where" className="font-serif text-2xl leading-tight text-ink">
                {here ? here.name : "the open air"}
              </h2>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-lg font-semibold tabular-nums ${
                lowTime ? "animate-pulse border-signal bg-signal-wash text-ink" : "border-line bg-surface text-ink"
              }`}
              aria-label="Time left in this stage"
            >
              <Timer className="h-5 w-5" aria-hidden /> <StageCountdown attemptId={attemptId} deadlineIso={state.timer.deadlineAt} serverNowIso={state.timer.serverNow} />
            </span>
          </div>
          <div data-walkthrough="rooms">
            <RoomActions
              key={`${state.stage.id}:${state.currentRoomId}`}
              state={state}
              busy={busy !== null}
              onRoom={(roomId) => { setReading(null); setIntent({ kind: "room", roomId }); }}
              onLandmark={onLandmark}
              onDocument={onProp}
              onDoor={() => { if (here) void act(here.doorOpen ? "Closing…" : "Opening…", () => playApi.action(attemptId, { type: here.doorOpen ? "close_door" : "open_door", roomId: here.id })); }}
            />
          </div>
          {waitingDoor ? (
            <button type="button" className={primary} disabled={busy !== null} onClick={() => act("Knocking…", () => playApi.action(attemptId, { type: "knock", roomId: waitingDoor.roomId }))}>
              Knock on {waitingRoom?.name ?? "the door"}
            </button>
          ) : null}
        </section>

        {/* ── Middle: the conversation. This is the game; it gets the height. ── */}
        <section className={`${roomStyles.conversation} ${styles.conversation} flex flex-1 flex-col`} aria-labelledby="talk">
          {peopleHere.length > 0 ? (
            <>
              <div className={roomStyles.introduction}>
                <div>
                  <p className={roomStyles.eyebrow}>Room conversation</p>
                  <h2 id="talk" className={roomStyles.personName}>People here</h2>
                  <p className={roomStyles.personRole}>{peopleHere.map((person) => person.name).join(", ")}</p>
                </div>
              </div>
              {state.transcript.length === 0 && pendingSpeech === null ? (
                <p className={roomStyles.conversationHint}>Everyone here can hear you. Type a question below to start the conversation.</p>
              ) : null}
            </>
          ) : (
            <div className="px-5 py-4">
              <h2 id="talk" className="font-serif text-xl text-ink">No one is within speaking distance</h2>
              <p className="mt-2 text-sm text-muted">Use “Go somewhere” to find someone, or walk closer to a person on the map.</p>
            </div>
          )}

          <div ref={transcriptLog} className={`flex min-h-0 flex-col gap-3 overflow-y-auto px-5 ${state.transcript.length || pendingSpeech || speaking || state.pendingDialogue ? "flex-1 py-3 sm:py-4" : ""}`} role="log" aria-live="polite" aria-label="Conversation">
            {items.map((item) => {
              if (item.kind === "break") {
                return (
                  <div key={item.id} role="separator" className="flex items-center gap-2.5 pt-1">
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
                      {item.icon === "room" ? <DoorOpen className="h-4 w-4" aria-hidden /> : <UserRound className="h-4 w-4" aria-hidden />}
                      {item.label}
                    </span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </div>
                );
              }
              const m = item.message;
              const speaker = m.authorType === "agent" ? state.agents.find((a) => a.id === m.authorId) : null;
              const mine = m.authorType === "player";
              return (
                <div key={m.id} className={`flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                  {speaker ? <Portrait src={speaker.portraitUrl} name={speaker.name} size={36} /> : null}
                  <div className={`${styles.bubble} ${mine ? styles.myBubble : ""} min-w-0 max-w-[92%] px-4 py-2.5 leading-relaxed text-ink`}>
                    {!mine ? <p className="text-sm font-semibold text-muted">{m.authorName ?? "Someone"}</p> : null}
                    <p>{m.body}</p>
                  </div>
                </div>
              );
            })}
            {pendingSpeech ? (
              <div key={pendingSpeech.id} className="flex flex-row-reverse items-start gap-2.5">
                <div className={`${styles.bubble} ${styles.myBubble} min-w-0 max-w-[85%] px-4 py-2.5 leading-relaxed`}>
                  <p>{pendingSpeech.body}</p>
                </div>
              </div>
            ) : null}
            {speaking || state.pendingDialogue ? <div className="px-2"><Thinking label="The room is thinking" /></div> : null}
            <div ref={transcriptEnd} />
          </div>

          <form
            data-walkthrough="conversation"
            className={roomStyles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="conversation-message">Your message to the room</label>
            <div className={roomStyles.composerRow}>
            <input
              id="conversation-message"
              ref={composer}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy !== null || speaking || state.pendingDialogue || !peopleHere.length}
              placeholder={peopleHere.length ? "Type your question…" : "Find someone to talk to first"}
              className="min-h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 py-2 text-base text-ink placeholder:text-muted focus:border-record focus:outline-none disabled:opacity-60"
              maxLength={2000}
            />
            <button type="submit" className={`${primary} min-h-11`} disabled={busy !== null || speaking || state.pendingDialogue || !draft.trim() || !canSendToRoom}>
              {speaking || state.pendingDialogue ? <Pending>Sending</Pending> : "Send"}
            </button>
            </div>
          </form>
        </section>

        {/* ── Bottom, always visible: goals + the decision ─────────────────── */}
        <section className={`${styles.quests} flex flex-col gap-3 px-5 py-4 lg:min-h-0 lg:max-h-[34%] lg:overflow-y-auto`} aria-labelledby="decide">
          <div>
            <p className={styles.questHeading}><Flag size={15} aria-hidden /> Your next chapter</p>
            <p className="text-base leading-snug text-ink">{state.decisionPrompt}</p>
          </div>
          <div data-walkthrough="goals" className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted">Complete your goals, then make a decision to finish this stage.</p>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-base text-ink">
                <span className="font-semibold">Goals {goalsMet} of {goalsTotal}</span>
                <span className="ml-3 text-muted">Stage {state.stage.index + 1} of {state.stageCount}</span>
              </p>
              {state.accountClues.length ? (
                <button type="button" className="shrink-0 text-sm font-semibold text-world underline underline-offset-2" onClick={() => setAccountsOpen(true)}>
                  Compare accounts
                </button>
              ) : null}
            </div>
          </div>
          <div className={styles.progress} aria-hidden="true">
            {state.stage.objectives.map((objective) => <span key={objective.id} data-complete={objective.met} />)}
          </div>
          <p className="text-sm text-muted">Yellow = available now · Green = done · Grey = locked</p>
          <ul className="flex flex-col gap-2">
            {state.stage.objectives.map((o) => {
              const hintKey = `${state.stage.id}:${o.id}`;
              const hintLevel = goalHintLevels[hintKey] ?? 0;
              const missing = o.requires
                .filter((id) => !state.stage.objectives.find((candidate) => candidate.id === id)?.met)
                .map((id) => state.stage.objectives.find((candidate) => candidate.id === id)?.title ?? id);
              const locked = !o.met && missing.length > 0;
              return (
                <li key={o.id} className={`flex items-start gap-2.5 rounded-control border px-3 py-2 text-base leading-snug ${
                  o.met ? "border-world/30 bg-world-wash/50 text-world" : locked
                    ? "border-line bg-surface/50 text-muted"
                    : "border-[#b77900] bg-[#fff5bf] font-semibold text-ink"
                }`}>
                  <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    o.met ? "border-world bg-world text-paper" : locked
                      ? "border-line-strong bg-sunken text-muted"
                      : "border-[#8a5900] bg-[#facc15] text-ink"
                  }`}>
                    {o.met ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden /> : locked ? <Lock className="h-2.5 w-2.5" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold uppercase tracking-wide">{o.met ? "Done" : locked ? "Locked" : "Available now"}</span>
                    <span className={`block ${o.met ? "line-through" : ""}`}>{o.title}</span>
                    {!o.met && !locked && o.conversation ? (
                      <span className="block text-sm font-semibold text-[#704800]">
                        {o.conversation.exchanges < o.conversation.required
                          ? `Replies: ${o.conversation.exchanges} of ${o.conversation.required}`
                          : "Conversation needs a substantive answer"}
                      </span>
                    ) : null}
                    {locked ? (
                      <span className="flex items-start gap-1 text-sm font-normal text-muted">
                        <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Finish first: {missing.join("; ")}
                      </span>
                    ) : !o.met && state.objectiveHints[o.id] ? (
                      <span className="flex flex-col items-start gap-1 text-sm font-normal text-muted">
                        {hintLevel > 0 ? (
                          <span className="flex items-start gap-1">
                            <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            {hintLevel === 1 ? (state.objectiveClues[o.id] ?? state.objectiveHints[o.id]) : state.objectiveHints[o.id]}
                          </span>
                        ) : null}
                        {hintLevel < (state.objectiveClues[o.id] ? 2 : 1) ? (
                          <button
                            type="button"
                            className="inline-flex min-h-9 items-center gap-1 underline underline-offset-2 hover:text-ink"
                            onClick={() => setGoalHintLevels((levels) => ({ ...levels, [hintKey]: Math.min(2, (levels[hintKey] ?? 0) + 1) }))}
                          >
                            <HelpCircle className="h-3.5 w-3.5" aria-hidden /> {hintLevel ? "Clearer hint" : "Show hint"}
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>

          {canDecide ? (
            <div data-walkthrough="decision" className="flex flex-col gap-2 rounded-surface border border-signal bg-signal-wash p-3">
              <button type="button" className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-left" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
                <span id="decide" className="font-serif text-xl text-ink">
                  You can decide now
                </span>
                <span className="text-base text-muted">
                  {decided} of {state.commitments.length} decided. {decisionOpen ? "Hide" : "Show"}
                </span>
              </button>
              {decisionOpen ? (
                <>
                  <p className="text-base leading-snug text-ink">This ends the stage. There is no going back.</p>
                  <button type="button" className={`${subtle} self-start`} onClick={() => setNotesOpen(true)}>
                    <ScrollText className="h-4 w-4" aria-hidden /> Review your evidence ({collectedDocuments.length})
                  </button>
                  <ul className="flex flex-col gap-2">
                    {state.options.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className={`${o.available ? primary : chip} w-full flex-col items-start gap-0.5 text-left ${o.available ? "" : "min-h-11"}`}
                          disabled={!o.available || busy !== null || speaking || state.pendingDialogue}
                          onClick={() => decide(o.id)}
                        >
                          <span className="flex items-start gap-2 leading-snug">
                            {decidingOption === o.id ? <Spinner className="mt-0.5 h-4 w-4" /> : null}
                            {o.label}
                          </span>
                          {decidingOption === o.id ? (
                            <span className="text-sm font-normal opacity-80">Deciding… writing what happens next.</span>
                          ) : null}
                          {!o.available ? (
                            <span className="inline-flex items-center gap-1 text-sm font-normal text-muted">
                              <Lock className="h-3.5 w-3.5" aria-hidden /> {o.unavailableReason}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {decidingOption ? (
                    <p role="status" aria-live="polite" className="inline-flex items-center gap-2 text-base text-ink">
                      <Spinner /> Deciding… this can take a moment while the next chapter is written.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <button data-walkthrough="decision" type="button" className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-dashed border-line-strong px-3 py-2.5 text-left hover:border-ink" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
              <span id="decide" className="inline-flex items-center gap-2 text-base font-semibold text-muted">
                <Lock className="h-4 w-4" aria-hidden /> Decision locked. Finish your goals first.
              </span>
              <span className="text-sm text-muted">{decisionOpen ? "Hide" : "See choices"}</span>
            </button>
          )}
          {!canDecide && decisionOpen ? (
            <ul className="flex flex-col gap-1.5 text-base leading-snug text-muted">
              {state.options.map((o) => (
                <li key={o.id} className="rounded-control bg-surface px-3 py-2">
                  {o.label}
                  {o.unavailableReason ? <span className="block text-sm">{o.unavailableReason}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {state.announcements.length ? (
            <div role="log" aria-label="Announcements" className="flex flex-col gap-1.5">
              {state.announcements.map((announcement) => <p key={announcement.id} role="status" className="rounded-control border border-line bg-surface px-3.5 py-2.5 text-base leading-snug text-ink">{announcement.body}</p>)}
            </div>
          ) : null}
          {offline ? (
            <p role="alert" className="rounded-control border border-signal bg-signal-wash px-3.5 py-2.5 text-base leading-snug text-ink">
              Connection lost.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => window.location.reload()}>
                Reload to continue
              </button>
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="rounded-control border border-signal bg-signal-wash px-3.5 py-2.5 text-base leading-snug text-ink">
              {notice}
            </p>
          ) : null}
          {busy && busy !== "Speaking…" ? (
            <p role="status" aria-live="polite" className="inline-flex items-center gap-2 text-base text-muted">
              <Spinner /> {busy}
            </p>
          ) : null}
        </section>
      </aside>

      {reading || notesOpen ? (
        <DocumentReader
          entry={openDocument ?? preparedDocument}
          saved={openDocument !== null}
          name={openDocumentName}
          imageUrl={openDocument ? state.evidenceImages[openDocument.id] ?? null : null}
          documents={collectedDocuments}
          selectedId={activeDocumentId}
          onSelect={setReading}
          error={activeDocumentId ? documentErrors[activeDocumentId] ?? null : null}
          onRetry={() => { if (activeDocumentId) void read(activeDocumentId); }}
          onClose={() => { setReading(null); setNotesOpen(false); }}
        />
      ) : null}

      {accountsOpen ? (
        <AdventureDialog kind="accounts" titleId="accounts-title" onClose={() => setAccountsOpen(false)}>
          <div>
            <p className={styles.modalKicker}><ScrollText size={14} aria-hidden /> Follow the conflicting accounts</p>
            <h2 id="accounts-title" className={styles.modalTitle}>What do the witnesses disagree about?</h2>
            <p className="mt-2 text-base text-muted">Ask both people the same question, then check the document against what they told you.</p>
          </div>
          {state.accountClues.map((clue) => (
            <section key={clue.id} className="flex flex-col gap-3 border-t border-line pt-4" aria-label={clue.question}>
              <h3 className="font-serif text-xl text-ink">{clue.question}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {[clue.first, clue.second].map((account) => {
                  const roomId = state.agents.find((agent) => agent.id === account.agentId)?.roomId ?? null;
                  const roomName = state.rooms.find((room) => room.id === roomId)?.name ?? "the map";
                  const nearby = peopleHere.some((person) => person.id === account.agentId);
                  return (
                    <div key={account.agentId} className="flex flex-col gap-2 rounded-control border border-line bg-surface p-3">
                      <p className="font-semibold text-ink">{account.name}</p>
                      {account.account ? (
                        <>
                          <p className="text-sm text-muted">Their account: {account.account}</p>
                          {account.quote ? <blockquote className="border-l-2 border-world pl-2 text-sm text-ink">“{account.quote}”</blockquote> : null}
                        </>
                      ) : <p className="text-sm text-muted">Hear their answer to reveal this account.</p>}
                      <button type="button" className={`${subtle} mt-auto text-sm`} disabled={!roomId} onClick={() => {
                        setAccountsOpen(false);
                        if (nearby) {
                          setDraft(`${account.name}, ${clue.question}`);
                          window.requestAnimationFrame(() => composer.current?.focus());
                        } else if (roomId) setIntent({ kind: "room", roomId });
                      }}>
                        {nearby ? `Ask ${account.name}` : `Find ${account.name} in ${roomName}`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-control border border-line bg-surface p-3 text-sm">
                <p className="font-semibold text-ink">Check: {clue.evidence.name}</p>
                {clue.evidence.found ? (
                  <button type="button" className="mt-1 text-world underline underline-offset-2" onClick={() => { setAccountsOpen(false); setReading(clue.evidence.id); }}>
                    Reopen this document
                  </button>
                ) : <p className="mt-1 text-muted">Find this document on the map to weigh both accounts.</p>}
              </div>
            </section>
          ))}
          <button type="button" className={`${primary} self-start`} onClick={() => setAccountsOpen(false)}>Continue exploring</button>
        </AdventureDialog>
      ) : null}

      {openLandmark ? (
        <AdventureDialog kind="landmark" titleId="landmark-title" descriptionId="landmark-description" onClose={() => setInspectingLandmark(null)}>
            <div>
              <p className={styles.modalKicker}><MapPin size={14} aria-hidden /> {state.rooms.find((room) => room.id === openLandmark.roomId)?.name ?? "Out in the world"}</p>
              <h2 id="landmark-title" className={styles.modalTitle}>{openLandmark.name}</h2>
            </div>
            <p id="landmark-description" className="whitespace-pre-line text-lg leading-relaxed text-ink">{openLandmark.description}</p>
            <div className={styles.modalFooter}>
              <span className={styles.fieldStamp}><Compass size={16} aria-hidden /> An explorer’s field note</span>
              <button type="button" className={`${primary} w-fit`} onClick={() => setInspectingLandmark(null)} autoFocus>Continue exploring <ArrowRight size={18} aria-hidden /></button>
            </div>
        </AdventureDialog>
      ) : null}
    </div>
  );
}
