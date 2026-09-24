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
import { ArrowRight, Check, CornerDownRight, DoorOpen, FileText, HelpCircle, Lock, Search, Timer, UserRound, Volume2, VolumeX } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { canHearSpeech, findPath, isInPhysicalInteractionRange, isWalkable, spaceAt, type DoorState, type Point, type StageMap } from "@adventure/game-core";
import { playApi } from "./api";
import type { MapIntent } from "./map-canvas";
import { useSoundCues } from "./sound";
import { restartAttempt } from "@/app/play/[attemptId]/actions";
import { StageCountdown } from "@/components/stage-countdown";
import { Pending, Spinner, Thinking } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";
import { withSceneBreaks } from "@/lib/play/transcript";
import { DocumentReader } from "./document-reader";

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
  const box = { width: size, height: size, minWidth: size, minHeight: size };
  if (!src) {
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
  const pixel = src.startsWith("/game/");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage urls are dynamic and the facesets are tiny
    <img
      src={src}
      alt={`${name}'s portrait`}
      width={size}
      height={size}
      className="shrink-0 self-start rounded-control border border-line bg-[#e7d4a8] object-cover"
      style={{ ...box, imageRendering: pixel ? "pixelated" : undefined }}
    />
  );
}

const chip =
  "inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3.5 py-2 text-base font-semibold leading-tight text-ink transition-colors hover:border-ink disabled:opacity-60";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-4 py-2 text-base font-semibold leading-snug text-paper transition-colors hover:bg-record disabled:opacity-60";
const subtle =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-line-strong bg-transparent px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-60";
const label = "text-sm font-semibold text-muted";

export function PlayClient({
  attemptId,
  initialState,
  retriesAllowed,
}: {
  attemptId: string;
  initialState: PlayState;
  retriesAllowed: boolean;
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
  const [addressee, setAddressee] = useState<string | null>(null);
  const [intent, setIntent] = useState<MapIntent>(null);
  const [pendingTalk, setPendingTalk] = useState<string | null>(null);
  const [waitingAtDoor, setWaitingAtDoor] = useState<string | null>(null);
  const [lastResolution, setLastResolution] = useState<string | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [loadingDocuments, setLoadingDocuments] = useState<string[]>([]);
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({});
  const readingRequests = useRef(new Set<string>());
  const [inspectingLandmark, setInspectingLandmark] = useState<string | null>(null);
  const [pendingLandmark, setPendingLandmark] = useState<string | null>(null);
  const [pendingRead, setPendingRead] = useState<string | null>(null);
  const [roleBriefOpen, setRoleBriefOpen] = useState(initialState.status === "active" && initialState.revision === 0);
  const [hintVisible, setHintVisible] = useState(true);
  const transcriptLog = useRef<HTMLDivElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const readRef = useRef<(evidenceId: string, open?: boolean) => void>(() => {});
  const autoReadAt = useRef<string | null>(null);
  const revision = useRef(initialState.revision);
  const serverViewKey = useRef(`${initialState.stage.id}:${initialState.status}`);
  const { muted, toggleMuted, cues } = useSoundCues(state, notice);

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
    if (canDecide) setDecisionOpen(true);
  }, [canDecide]);
  useEffect(() => {
    setDecisionOpen(false);
  }, [state.stage.id]);

  const here = state.rooms.find((r) => r.id === state.currentRoomId) ?? null;
  const peopleHere = state.agents.filter((agent) => {
    const actor = state.actors.find((candidate) => candidate.id === agent.id);
    return state.map && visiblePosition && actor?.position
      ? canHearSpeech(state.map as StageMap, visiblePosition, actor.position)
      : state.hearingActorIds.includes(agent.id);
  });
  const effectiveAddressee = peopleHere.some((a) => a.id === addressee) ? addressee : peopleHere[0]?.id ?? null;
  const canSendToAddressee = effectiveAddressee !== null && state.hearingActorIds.includes(effectiveAddressee);
  const talkingTo = peopleHere.find((a) => a.id === effectiveAddressee) ?? null;
  const waitingRoom = waitingAtDoor ? state.rooms.find((room) => room.id === waitingAtDoor) : null;
  const waitingDoor = waitingAtDoor ? state.map?.doors.find((door) => door.roomId === waitingAtDoor) : null;
  const items = withSceneBreaks(state.transcript, {
    currentRoomId: state.currentRoomId,
    roomName: (roomId) => state.rooms.find((room) => room.id === roomId)?.name ?? "the open air",
    actorName: (actorId) => state.agents.find((agent) => agent.id === actorId)?.name ?? "someone else",
  });
  const knockReady = waitingRoom?.doorOpen === false && waitingDoor !== null && waitingDoor !== undefined && state.playerPos !== null && state.playerPos.x === waitingDoor.outside.x && state.playerPos.y === waitingDoor.outside.y;

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
    if (!body || !roomId || !canSendToAddressee || busy !== null || speaking || current.pendingDialogue) return;
    setDraft("");
    setPendingSpeech({ id: crypto.randomUUID(), roomId, body });
    setSpeaking(true);
    setNotice(null);
    try {
      const result = await playApi.message(attemptId, { roomId, body, addresseeId: effectiveAddressee });
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

  // From the map: pick who to talk to and put the cursor in the box, so "walk up and talk" works.
  const onTalk = useCallback((actorId: string) => {
    setHintVisible(false);
    setReading(null);
    setAddressee(actorId);
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

  const openDocument = reading ? state.journal.find((entry) => entry.id === reading) ?? null : null;
  const openDocumentName = reading ? state.props.find((item) => item.id === reading)?.name ?? "Document" : "";
  const openLandmark = inspectingLandmark ? state.landmarks.find((item) => item.id === inspectingLandmark) ?? null : null;
  const pendingDocuments = loadingDocuments.filter((id) => !state.journal.some((entry) => entry.id === id) && state.props.some((prop) => prop.id === id));

  if (state.status === "completed") {
    return (
      <section className="mx-auto my-10 flex w-full max-w-2xl flex-col gap-5 px-6">
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
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {roleBriefOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/70 p-5" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-brief-title"
            aria-describedby="role-brief-description"
            className="flex w-full max-w-xl flex-col gap-5 rounded-surface border border-line bg-paper p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-center gap-2 text-world">
              <UserRound className="h-6 w-6" aria-hidden />
              <p className="text-base font-semibold uppercase tracking-wide">Your character</p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-lg capitalize text-muted">You are {state.player.name}</p>
              <h2 id="role-brief-title" className="font-serif text-3xl leading-tight text-ink sm:text-4xl">
                {state.player.role}
              </h2>
            </div>
            <p id="role-brief-description" className="text-lg leading-relaxed text-ink">
              {state.player.brief}
            </p>
            <div className="rounded-control border-l-[3px] border-world bg-surface px-4 py-3">
              <p className="text-sm font-semibold text-muted">Your first move</p>
              <p className="text-base text-ink">Work toward the goals shown.</p>
            </div>
            <button type="button" className={`${primary} min-h-12 w-full text-lg capitalize sm:w-fit sm:self-end`} autoFocus onClick={() => setRoleBriefOpen(false)}>
              Begin as {state.player.name}
            </button>
          </section>
        </div>
      ) : null}

      <section className="relative h-[32dvh] min-h-[11rem] shrink-0 bg-sunken lg:h-auto lg:min-h-0 lg:flex-1" aria-label="Map">
        <MapCanvas
          state={state}
          audio={{ muted, cues }}
          intent={intent}
          onIntentDone={() => setIntent(null)}
          onSteps={onSteps}
          onWaitingAtDoor={setWaitingAtDoor}
          onLocalPosition={(point) => setLocalPosition({ stageId: stateRef.current.stage.id, point })}
          onTalk={onTalk}
          onProp={onProp}
          onPickup={onPickup}
          onLandmark={onLandmark}
        />
        {hintVisible ? (
          <p className="pointer-events-none absolute left-3 right-3 top-3 rounded-control bg-inverse/85 px-3 py-1.5 text-sm font-semibold text-on-inverse lg:bottom-3 lg:right-48 lg:top-auto lg:px-3.5 lg:py-2 lg:text-base">
            <span className="lg:hidden">Tap to walk; tap a person, document, or landmark to interact.</span>
            <span className="hidden lg:inline">
              Use arrows or WASD to walk. Click a person, document, or landmark to interact; press Enter to talk.
            </span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setHintVisible((shown) => !shown)}
          aria-pressed={hintVisible}
          className="absolute bottom-3 right-36 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-inverse/85 px-3 py-2 text-on-inverse hover:bg-inverse"
        >
          <HelpCircle className="h-5 w-5" aria-hidden />
          <span className="sr-only">How to move and talk</span>
        </button>
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={muted}
          className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-control bg-inverse/85 px-3 py-2 text-base font-semibold text-on-inverse hover:bg-inverse lg:px-3.5"
        >
          {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          <span className="sr-only sm:not-sr-only">{muted ? "Sound off" : "Sound on"}</span>
        </button>
        {lastResolution ? (
          <div
            role="status"
            className="absolute inset-x-3 top-3 mx-auto max-h-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-surface border-l-[3px] border-world bg-surface p-4 text-ink shadow-xl sm:p-5"
          >
            <p className="mb-2 text-base font-semibold text-world">What happened</p>
            <p className="leading-relaxed sm:text-lg">{lastResolution}</p>
            <button type="button" className={`${primary} mt-4`} onClick={() => setLastResolution(null)}>
              Got it
            </button>
          </div>
        ) : null}
      </section>

      <aside className="flex min-h-0 w-full min-w-0 flex-col border-t border-line bg-paper text-base lg:w-[min(42rem,48vw)] lg:shrink-0 lg:border-l lg:border-t-0">
        {/* ── Top: where you are, where you can go ─────────────────────────── */}
        <section className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:min-h-0 lg:max-h-[32%] lg:overflow-y-auto" aria-labelledby="where">
          <button
            type="button"
            onClick={() => setRoleBriefOpen(true)}
            className="flex min-h-11 w-full items-center gap-3 rounded-control border border-world/40 bg-world-wash px-3.5 py-2 text-left text-ink transition-colors hover:border-world"
            aria-label={`Open your role brief: ${state.player.role}`}
          >
            <UserRound className="h-5 w-5 shrink-0 text-world" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-muted">You are playing</span>
              <span className="block truncate text-base font-semibold">{state.player.role}</span>
            </span>
            <span className="ml-auto shrink-0 text-sm font-semibold text-world underline underline-offset-4">Role brief</span>
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={label}>You are in</p>
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
          {state.landmarks.filter((landmark) => landmark.roomId === state.currentRoomId).map((landmark) => (
            <button key={landmark.id} type="button" className={chip} onClick={() => onLandmark(landmark.id)}>
              Inspect {landmark.name}
            </button>
          ))}
          <div className="flex flex-wrap gap-2">
            {state.rooms
              .filter((r) => r.id !== state.currentRoomId)
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={chip}
                  disabled={busy !== null}
                  onClick={() => {
                    setReading(null);
                    setIntent({ kind: "room", roomId: r.id });
                  }}
                >
                  <ArrowRight className="h-4 w-4" aria-hidden /> {r.name}
                  {!r.doorOpen ? <Lock className="h-4 w-4 text-muted" aria-label="door closed" /> : null}
                </button>
              ))}
            {here?.enclosure === "enclosed" ? (
              <button
                type="button"
                className={chip}
                disabled={busy !== null}
                onClick={() => act(here.doorOpen ? "Closing…" : "Opening…", () => playApi.action(attemptId, { type: here.doorOpen ? "close_door" : "open_door", roomId: here.id }))}
              >
                {here.doorOpen ? "Close door" : "Open door"}
              </button>
            ) : null}
            {knockReady ? (
              <button type="button" className={`${primary} min-h-10 py-1.5 text-sm`} disabled={busy !== null} onClick={() => act("Knocking…", () => playApi.action(attemptId, { type: "knock", roomId: waitingAtDoor! }))}>
                Knock on {waitingRoom?.name ?? "the door"}
              </button>
            ) : null}
          </div>
          {state.evidenceHere.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-l-[3px] border-world py-1 pl-3">
              <span className="text-base font-semibold text-world">Documents here</span>
              {state.evidenceHere.map((item) => item.canInspect || localCanInspect(state, visiblePosition, item.id) ? (
                <button key={item.id} type="button" className={chip} disabled={busy !== null} onClick={() => onProp(item.id)}>
                  <Search className="h-4 w-4" aria-hidden /> Read {item.name}
                </button>
              ) : (
                <button key={item.id} type="button" className={chip} disabled={busy !== null || item.position === null} onClick={() => item.position && setIntent({ kind: "point", point: item.position })}>
                  Walk to {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {/* ── Middle: the conversation. This is the game; it gets the height. ── */}
        <section className="flex min-h-0 flex-1 flex-col lg:min-h-80" aria-labelledby="talk">
          {peopleHere.length ? (
            <div className="flex gap-2 overflow-x-auto px-5 pt-4" role="radiogroup" aria-label="Who you are talking to" id="talk">
              {peopleHere.map((a) => {
                const active = a.id === effectiveAddressee;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setAddressee(a.id)}
                    className={`flex min-w-0 shrink-0 items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors ${
                      active ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink"
                    }`}
                  >
                    <Portrait src={a.portraitUrl} name={a.name} size={40} />
                    <span className="min-w-0 leading-tight">
                      <span className="block text-base font-semibold">{a.name}</span>
                      {a.role ? <span className={`block max-w-[14rem] truncate text-sm ${active ? "text-paper/85" : "text-muted"}`}>{a.role}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p id="talk" className="px-5 pt-4 text-base text-ink">
              {here ? "No one is here. Try another building." : "Walk into a building to find someone to talk to."}
            </p>
          )}

          <div ref={transcriptLog} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3 sm:py-4" role="log" aria-live="polite" aria-label="Conversation">
            {state.transcript.length === 0 && pendingSpeech === null ? (
              <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center lg:m-auto">
                <p className="font-serif text-lg text-ink sm:text-xl">Nothing has been said yet</p>
                <p className="hidden text-base leading-relaxed text-muted sm:block">
                  {talkingTo ? `Ask ${talkingTo.name} a question.` : "Find someone to talk to."}
                </p>
              </div>
            ) : null}
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
                  <div className={`min-w-0 max-w-[92%] rounded-surface px-4 py-2.5 leading-relaxed ${mine ? "rounded-tr-sm bg-ink text-paper" : "rounded-tl-sm bg-surface text-ink"}`}>
                    {!mine ? <p className="text-sm font-semibold text-muted">{m.authorName ?? "Someone"}</p> : null}
                    <p>{m.body}</p>
                  </div>
                </div>
              );
            })}
            {pendingSpeech ? (
              <div key={pendingSpeech.id} className="flex flex-row-reverse items-start gap-2.5">
                <div className="min-w-0 max-w-[85%] rounded-surface rounded-tr-sm bg-ink px-4 py-2.5 leading-relaxed text-paper">
                  <p>{pendingSpeech.body}</p>
                </div>
              </div>
            ) : null}
            {speaking || state.pendingDialogue ? <div className="px-2"><Thinking label={`${talkingTo?.name ?? "They"} is thinking`} /></div> : null}
            <div ref={transcriptEnd} />
          </div>

          <form
            className="flex gap-2 px-5 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              ref={composer}
              aria-label="What you say"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy !== null || speaking || state.pendingDialogue || !peopleHere.length}
              placeholder={talkingTo ? `Ask ${talkingTo.name.split(" ").at(-1)} something…` : "Find someone to talk to first"}
              className="min-h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 py-2 text-base text-ink placeholder:text-muted focus:border-record focus:outline-none disabled:opacity-60"
              maxLength={2000}
            />
            <button type="submit" className={`${primary} min-h-11`} disabled={busy !== null || speaking || state.pendingDialogue || !draft.trim() || !canSendToAddressee}>
              {speaking || state.pendingDialogue ? <Pending>Saying it</Pending> : canSendToAddressee ? "Say it" : "Coming closer…"}
            </button>
          </form>
        </section>

        {/* ── Bottom, always visible: goals + the decision ─────────────────── */}
        <section className="flex flex-col gap-3 border-t border-line bg-sunken/60 px-5 py-4 lg:min-h-0 lg:max-h-[34%] lg:overflow-y-auto" aria-labelledby="decide">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-base text-ink">
              <span className="font-semibold">Goals {goalsMet} of {goalsTotal}</span>
              <span className="ml-3 text-muted">Stage {state.stage.index + 1} of {state.stageCount}</span>
            </p>
              <button type="button" className={subtle} onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen} aria-controls="collected-notes">
                Notes ({state.journal.length + pendingDocuments.length})
              </button>
          </div>
          {notesOpen ? (
            <ul id="collected-notes" aria-label="Collected notes" className="flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto border-l-[3px] border-world pl-3">
              {!state.journal.length && !pendingDocuments.length ? <li className="p-3 text-muted">No scrolls collected yet. Walk to a document to read it.</li> : null}
              {pendingDocuments.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => setReading(id)} className="flex min-h-11 w-full items-center gap-3 rounded-control bg-surface p-3 text-left text-ink">
                    {documentErrors[id] ? <FileText className="h-5 w-5 shrink-0" /> : <Spinner />}
                    <span>{state.props.find((prop) => prop.id === id)?.name ?? "Document"}<span className="block text-sm text-muted">{documentErrors[id] ? "Couldn’t load · open to retry" : "Loading scroll… Open to read"}</span></span>
                  </button>
                </li>
              ))}
              {state.journal.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => setReading(j.id)}
                    className="flex w-full gap-3 rounded-control bg-surface p-3 text-left text-base leading-relaxed text-ink hover:bg-sunken"
                  >
                    {state.evidenceImages[j.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
                      <img src={state.evidenceImages[j.id]} alt="" className="h-14 w-14 flex-none rounded-control object-cover" />
                    ) : null}
                    <span className="min-w-0">
                      <span className="line-clamp-2 block">{j.text}</span>
                      {j.sourceSpan ? <span className="mt-1 block font-serif text-base italic text-record">{j.sourceSpan}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {state.stage.objectives.map((o) => (
              <li key={o.id} className={`flex items-start gap-2.5 text-base leading-snug ${o.met ? "text-muted" : "font-semibold text-ink"}`}>
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${o.met ? "border-world bg-world text-paper" : "border-line-strong"}`}
                >
                  {o.met ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden /> : null}
                </span>
                <span className="min-w-0">
                  <span className={o.met ? "line-through" : ""}>{o.title}</span>
                  {!o.met && state.objectiveHints[o.id] ? (
                    <span className="flex items-start gap-1 text-sm font-normal text-muted">
                      <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {state.objectiveHints[o.id]}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">{o.met ? "done" : "not yet"}</span>
              </li>
            ))}
          </ul>

          {canDecide ? (
            <div className="flex flex-col gap-2 rounded-surface border border-signal bg-signal-wash p-3">
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
                  <ul className="flex flex-col gap-2">
                    {state.options.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className={`${o.available ? primary : chip} w-full flex-col items-start gap-0.5 text-left ${o.available ? "" : "min-h-11"}`}
                          disabled={!o.available || busy !== null || speaking || state.pendingDialogue}
                          onClick={() => decide(o.id)}
                        >
                          <span className="leading-snug">{o.label}</span>
                          {!o.available ? (
                            <span className="inline-flex items-center gap-1 text-sm font-normal text-muted">
                              <Lock className="h-3.5 w-3.5" aria-hidden /> {o.unavailableReason}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-dashed border-line-strong px-3 py-2.5 text-left hover:border-ink" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
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

      {reading ? (
        <DocumentReader
          entry={openDocument}
          name={openDocumentName}
          imageUrl={openDocument ? state.evidenceImages[openDocument.id] ?? null : null}
          position={openDocument ? state.journal.findIndex((entry) => entry.id === openDocument.id) + 1 : null}
          total={state.journal.length}
          error={reading ? documentErrors[reading] ?? null : null}
          onRetry={() => void read(reading)}
          onClose={() => setReading(null)}
        />
      ) : null}

      {openLandmark ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-inverse/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="landmark-title">
          <div className="flex max-h-[80dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-surface border-l-[3px] border-world bg-paper p-5 shadow-xl sm:p-6">
            <div>
              <p className={label}>You inspect</p>
              <h2 id="landmark-title" className="font-serif text-2xl leading-tight text-ink">{openLandmark.name}</h2>
            </div>
            <p className="whitespace-pre-line text-lg leading-relaxed text-ink">{openLandmark.description}</p>
            <button type="button" className={`${primary} w-fit`} onClick={() => setInspectingLandmark(null)} autoFocus>Continue exploring</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
