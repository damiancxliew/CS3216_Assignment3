"use client";

/**
 * The map: `@adventure/game-core` decides what is walkable, `@adventure/game-client`
 * draws it. The client owns the walk between tiles; the server owns which room
 * the player is in. Crossing into a room posts `move_room`; if the server refuses
 * (a closed door, a stale stage), the player is put back.
 *
 * Agent markers use the same server position as speech and interaction checks.
 */
import {
  canHearSpeech,
  canStep,
  findPath,
  isWalkable,
  spaceAt,
  type DoorState,
  type Point,
  type StageMap,
} from "@adventure/game-core";
import type { SoundCueId } from "@adventure/game-client";
import { useEffect, useRef } from "react";

import { ASSET_BASE, PLAYER_CHARACTER } from "@/lib/play/appearance";
import { MAX_PENDING_STEPS, MAX_STEPS_PER_REQUEST, optimisticAdvance, settleBatch, type PendingStep } from "@/lib/play/optimistic-queue";
import { OUTDOORS_ROOM_ID } from "@/lib/turn-api/contract";
import type { PlayState } from "@/lib/play/session";
import type { ServerTiming } from "./api";

const STEP_MS = 160;

const KEYS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
};

export type MapIntent = { kind: "room"; roomId: string } | { kind: "point"; point: Point } | { kind: "actor"; actorId: string } | null;

export interface MapCanvasProps {
  state: PlayState;
  /** Sound on/off and keyed one-shot cues; the renderer plays each key once. */
  audio: { muted: boolean; cues: { key: string; id: SoundCueId }[] };
  /** Where the player wants to go, set by the panel ("Walk to the bazaar"). Cleared by the canvas when reached. */
  intent: MapIntent;
  onIntentDone: () => void;
  /** The player stepped into a room the server does not know they are in. Resolve to false to put them back. */
  onSteps: (from: Point, path: Point[]) => Promise<{ position: Point | null; accepted: boolean; retry: boolean; timings?: ServerTiming; requestSentAt?: number; acknowledgedAt?: number }>;
  /** The position shown by the map, including steps still awaiting server acknowledgement. */
  onLocalPosition: (position: Point | null) => void;
  /** The player is standing outside a closed door. */
  onWaitingAtDoor: (roomId: string | null) => void;
  /** The player clicked a character, or pressed Enter/E with someone in the room: start talking to them. */
  onTalk: (actorId: string) => void;
  /** The player clicked a document lying on the map: read it, or walk over to it first. */
  onProp: (propId: string) => void;
  onLandmark: (landmarkId: string) => void;
}

function doorsOf(state: PlayState): Record<string, DoorState> {
  return Object.fromEntries((state.map?.doors ?? []).map((door) => [door.id, state.rooms.find((room) => room.id === door.roomId)?.doorOpen ? "open" : "closed"]));
}

/** Deterministic interior tile for the i-th occupant of a room, away from the door. */
function seatIn(map: StageMap, roomId: string, index: number): Point | null {
  const room = map.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const door = map.doors.find((d) => d.roomId === roomId);
  const interior: Point[] = [];
  for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
    for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
      if (door && door.inside.x === x && door.inside.y === y) continue;
      interior.push({ x, y });
    }
  }
  // Middle of the room first, then spiral outwards by distance from the centre.
  const cx = room.x + room.width / 2;
  const cy = room.y + room.height / 2;
  interior.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return interior[index % interior.length] ?? null;
}

/** A path tile for the n-th person standing about outdoors, spread along the main road. */
function outdoorSeat(map: StageMap, index: number): Point | null {
  const road: Point[] = [];
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) if (map.tiles[y]?.[x] === "path") road.push({ x, y });
  if (road.length === 0) return null;
  road.sort((a, b) => a.y - b.y || a.x - b.x);
  return road[Math.floor(((index * 7 + 3) % road.length))] ?? null;
}

export function MapCanvas({ state, audio, intent, onIntentDone, onSteps, onLocalPosition, onWaitingAtDoor, onTalk, onProp, onLandmark }: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, audio, intent, onIntentDone, onSteps, onLocalPosition, onWaitingAtDoor, onTalk, onProp, onLandmark });
  latest.current = { state, audio, intent, onIntentDone, onSteps, onLocalPosition, onWaitingAtDoor, onTalk, onProp, onLandmark };
  const playerPos = useRef<Point | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const intentHandlerRef = useRef<((next: MapIntent) => void) | null>(null);
  const reconcileRef = useRef<((next: PlayState) => void) | null>(null);
  const acknowledgedRevision = useRef(state.revision);

  // Mount the renderer once per map. Phaser is browser-only, so it is imported here, not at module top.
  const mapId = state.map?.id ?? null;
  useEffect(() => {
    const map = latest.current.state.map;
    const parent = host.current;
    if (!map || !parent) return;
    const controller = new AbortController();
    let destroyed = false;
    let view: import("@adventure/game-client/view").MapView | null = null;
    let facing: "down" | "up" | "left" | "right" = "down";
    let path: Point[] = [];
    let pathInputAt: number | undefined;
    let sendInFlight = false;
    let pending: PendingStep[] = [];
    let nextSendAt = 0;
    let sendTimer: number | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const perfEnabled = (() => {
      try {
        if (new URLSearchParams(window.location.search).get("perf") === "1") window.localStorage.setItem("play:perf", "1");
        return window.localStorage.getItem("play:perf") === "1";
      } catch {
        return false;
      }
    })();
    const held = new Map<string, Point>();
    let repeat: number | undefined;

    const snapshot = () => {
      const s = latest.current.state;
      const doors = doorsOf(s);
      const occupantsByRoom = new Map<string, number>();
      const player = playerPos.current ?? s.playerPos ?? { x: 1, y: 1 };
      const actors = [
        { id: "player", name: "You", position: player, space: spaceAt(map as StageMap, player), targetRoomId: null, status: path.length ? ("moving" as const) : ("idle" as const), sprite: PLAYER_CHARACTER, facing },
        ...s.actors
          .filter((a) => a.kind === "agent")
          .map((a) => {
            const key = a.roomId ?? OUTDOORS_ROOM_ID;
            const n = occupantsByRoom.get(key) ?? 0;
            occupantsByRoom.set(key, n + 1);
            const position = a.position ?? (a.roomId ? seatIn(map as StageMap, a.roomId, n + 1) : outdoorSeat(map as StageMap, n));
            if (!position) return null;
            return {
              id: a.id,
              name: a.name,
              position,
              space: spaceAt(map as StageMap, position),
              targetRoomId: null,
              status: "idle" as const,
              interactive: canHearSpeech(map as StageMap, player, position),
              ...(a.sprite ? { sprite: a.sprite } : {}),
            };
          }).filter((actor): actor is NonNullable<typeof actor> => actor !== null),
      ];
      const goal = path.length ? { kind: "point" as const, point: path[path.length - 1]! } : null;
      const props = s.props.map((prop) => ({ id: prop.id, name: prop.name, position: prop.position, found: prop.found, ...(s.evidenceImages[prop.id] ? { imageUrl: s.evidenceImages[prop.id] } : {}) }));
      return {
        // Keep music selection stable for this stage while allowing other stages and adventures to vary.
        seed: `${s.adventureId}:${s.stage.id}`,
        map: map as StageMap,
        doors,
        actors,
        props,
        landmarks: s.landmarks.map((landmark) => ({ id: landmark.id, roomId: landmark.roomId, name: landmark.name, position: landmark.position, ...(s.roomImages[landmark.id] ? { imageUrl: s.roomImages[landmark.id] } : {}) })),
        playerGoal: goal,
        playerStatus: path.length ? ("moving" as const) : ("idle" as const),
        running: true,
        npcRoutes: false,
        revision: s.revision,
        roomNames: Object.fromEntries(s.rooms.map((r) => [r.id, r.name])),
        roomImages: s.roomImages,
        mapTheme: s.stage.mapTheme,
        ambient: { id: s.stage.ambientOverlay, intensity: Math.min(3, Math.max(1, s.stage.overlayIntensity)) as 1 | 2 | 3 },
        // One-shot effects are keyed by announcement so each plays once, in the room the player is in.
        effects: s.announcements.length
          ? s.pendingEffects.map((e, i) => ({ key: `${s.announcements[s.announcements.length - 1]!.id}:${i}`, id: e.id, roomId: typeof e.at === "string" ? e.at : s.currentRoomId }))
          : [],
        audio: latest.current.audio,
      };
    };
    const render = () => view?.render(snapshot());
    renderRef.current = render;
    const showPosition = (position: Point | null) => {
      playerPos.current = position;
      latest.current.onLocalPosition(position);
    };

    const logBatch = (step: PendingStep, acknowledgement: { timings?: ServerTiming; requestSentAt?: number; acknowledgedAt?: number }, stepsSent: number, queueDepth: number) => {
      if (!perfEnabled || !step.requestSentAt) return;
      console.info("[play-perf] step", {
        keydownToLocalMoveMs: Number((step.movedAt - step.inputAt).toFixed(1)),
        requestToAckMs: Number(((acknowledgement.acknowledgedAt ?? performance.now()) - step.requestSentAt).toFixed(1)),
        serverTiming: acknowledgement.timings ?? {},
        stepsSent,
        queueDepth,
      });
    };

    const drain = async () => {
      if (destroyed || sendInFlight || pending.length === 0 || latest.current.state.map?.id !== mapId) return;
      // Commit a continuing walk in full batches, then flush a partial batch
      // as soon as the player stops so interaction can begin.
      if (pending.length < MAX_STEPS_PER_REQUEST && (path.length > 0 || held.size > 0)) return;
      if (sendTimer !== undefined) {
        window.clearTimeout(sendTimer);
        sendTimer = undefined;
      }
      const wait = nextSendAt - performance.now();
      if (wait > 0) {
        if (sendTimer === undefined) sendTimer = window.setTimeout(() => {
          sendTimer = undefined;
          void drain();
        }, wait);
        return;
      }
      const batch = pending.slice(0, MAX_STEPS_PER_REQUEST);
      const count = batch.length;
      const step = batch[0]!;
      step.requestSentAt ??= performance.now();
      sendInFlight = true;
      let acknowledgement: { position: Point | null; accepted: boolean; retry: boolean; timings?: ServerTiming; requestSentAt?: number; acknowledgedAt?: number };
      try {
        // A new token accrues after one step interval. The walk animation has
        // already spent time on this batch, so waiting for every token to refill
        // again would unnecessarily stall the next interaction.
        nextSendAt = performance.now() + STEP_MS;
        acknowledgement = await latest.current.onSteps(step.from, batch.map((queued) => queued.to));
      } catch {
        acknowledgement = { position: latest.current.state.playerPos, accepted: false, retry: false };
      }
      sendInFlight = false;
      if (destroyed || latest.current.state.map?.id !== mapId) return;
      const acknowledgedAt = acknowledgement.acknowledgedAt ?? performance.now();
      if (acknowledgement.retry) {
        const position = acknowledgement.position;
        if (position && (position.x !== step.from.x || position.y !== step.from.y)) {
          const destination = path.at(-1) ?? pending.at(-1)?.to;
          showPosition(position);
          pending = [];
          path = [];
          pathInputAt = undefined;
          render();
          if (destination) window.setTimeout(() => {
            if (!destroyed && latest.current.state.map?.id === mapId) goTo(destination);
          }, 0);
          else latest.current.onIntentDone();
        }
        nextSendAt = acknowledgedAt + 80;
        void drain();
        return;
      }

      pending = settleBatch(pending, acknowledgement.accepted ? "accepted" : "rollback", count);
      if (!acknowledgement.accepted) {
        pending = [];
        path = [];
        pathInputAt = undefined;
        if (acknowledgement.position) showPosition(acknowledgement.position);
      } else if (pending.length === 0 && acknowledgement.position && (!playerPos.current || acknowledgement.position.x !== playerPos.current.x || acknowledgement.position.y !== playerPos.current.y)) {
        showPosition(acknowledgement.position);
        path = [];
        pathInputAt = undefined;
      }
      const door = map.doors.find((candidate) => candidate.outside.x === acknowledgement.position?.x && candidate.outside.y === acknowledgement.position?.y && doorsOf(latest.current.state)[candidate.id] === "closed");
      latest.current.onWaitingAtDoor(door?.roomId ?? null);
      render();
      logBatch(step, { ...acknowledgement, acknowledgedAt }, count, pending.length);
      if (path.length === 0) latest.current.onIntentDone();
      void drain();
    };

    const stepTo = (to: Point, inputAt = performance.now()) => {
      if (latest.current.state.map?.id !== mapId || pending.length >= MAX_PENDING_STEPS) return;
      const s = latest.current.state;
      const from = playerPos.current ?? s.playerPos;
      if (!from) return;
      const doors = doorsOf(s);
      if (!canStep(map as StageMap, doors, from, to)) {
        // Walked into a closed door: stop and offer a knock.
        const door = map.doors.find((d) => d.position.x === to.x && d.position.y === to.y);
        if (door && doors[door.id] === "closed" && from.x === door.outside.x && from.y === door.outside.y) latest.current.onWaitingAtDoor(door.roomId);
        path = [];
        pathInputAt = undefined;
        render();
        return;
      }
      const ddx = to.x - from.x;
      const ddy = to.y - from.y;
      facing = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? "right" : "left") : ddy > 0 ? "down" : "up";
      const advanced = optimisticAdvance(from, { to, inputAt, movedAt: 0 }, pending);
      if (!advanced) return;
      showPosition(advanced.position);
      pending = advanced.queue;
      if (path[0]?.x === to.x && path[0]?.y === to.y) path.shift();
      render();
      pending.at(-1)!.movedAt = performance.now();
      void drain();
    };

    const walk = window.setInterval(() => {
      if (document.visibilityState !== "visible" || path.length === 0) return;
      const next = path[0]!;
      const inputAt = pathInputAt;
      pathInputAt = undefined;
      void stepTo(next, inputAt);
    }, STEP_MS);

    const goTo = (target: Point, inputAt = performance.now()) => {
      const from = playerPos.current ?? latest.current.state.playerPos;
      if (!from) return;
      const doors = doorsOf(latest.current.state);
      let found = findPath(map as StageMap, doors, from, target);
      if (!found) {
        // Aim for the doorstep of a closed room, so the player can knock.
        const room = map.rooms.find((candidate) => target.x >= candidate.x && target.x < candidate.x + candidate.width && target.y >= candidate.y && target.y < candidate.y + candidate.height);
        const door = map.doors.find((candidate) => candidate.roomId === room?.id);
        found = door ? findPath(map as StageMap, doors, from, door.outside) : null;
      }
      path = found ?? [];
      pathInputAt = found && found.length > 0 ? inputAt : undefined;
      render();
      if (!found || found.length === 0) latest.current.onIntentDone();
    };
    const goToRoom = (roomId: string) => {
      const room = map.rooms.find((candidate) => candidate.id === roomId);
      if (!room) return;
      if (room.enclosure === "open") {
        goTo({ x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) });
        return;
      }
      const door = map.doors.find((d) => d.roomId === roomId);
      if (!door) return;
      const doors = doorsOf(latest.current.state);
      goTo(isWalkable(map as StageMap, doors, door.position) ? door.inside : door.outside);
    };
    const goToActor = (actorId: string) => {
      const target = latest.current.state.actors.find((actor) => actor.id === actorId)?.position;
      const from = playerPos.current ?? latest.current.state.playerPos;
      if (!target || !from) return;
      if (canHearSpeech(map as StageMap, from, target)) {
        goTo(from);
        return;
      }
      const route = findPath(map as StageMap, doorsOf(latest.current.state), from, target);
      goTo(route?.find((point) => canHearSpeech(map as StageMap, point, target)) ?? target);
    };
    intentHandlerRef.current = (next) => {
      if (!next) {
        path = [];
        pathInputAt = undefined;
        render();
        void drain();
        return;
      }
      if (next.kind === "room") goToRoom(next.roomId);
      else if (next.kind === "actor") goToActor(next.actorId);
      else goTo(next.point);
    };
    reconcileRef.current = (next) => {
      if (next.revision < acknowledgedRevision.current) return;
      acknowledgedRevision.current = next.revision;
      if (pending.length === 0 && !sendInFlight && next.playerPos && (!playerPos.current || playerPos.current.x !== next.playerPos.x || playerPos.current.y !== next.playerPos.y)) {
        showPosition(next.playerPos);
        path = [];
        pathInputAt = undefined;
      }
      const current = playerPos.current;
      if (current && !isWalkable(map as StageMap, doorsOf(next), current)) {
        path = [];
        pathInputAt = undefined;
      }
      render();
    };

    const clearHeld = () => {
      held.clear();
      if (repeat !== undefined) window.clearInterval(repeat);
      repeat = undefined;
      void drain();
    };
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || typing(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const target = event.target instanceof Element ? event.target : null;
      if (key === "Enter" && target?.closest("button, a, summary, [role=\"button\"], [role=\"radio\"]")) return;
      if (key === "Enter" || key === "e") {
        // Talk to whoever is in the room with you.
        const s = latest.current.state;
        const point = playerPos.current ?? s.playerPos;
        const here = s.agents.filter((agent) => {
          const position = s.actors.find((actor) => actor.id === agent.id)?.position;
          return point && position ? canHearSpeech(map as StageMap, point, position) : s.hearingActorIds.includes(agent.id);
        });
        if (here.length > 0) {
          event.preventDefault();
          latest.current.onTalk(here[0]!.id);
        }
        return;
      }
      const delta = KEYS[key];
      if (!delta) return;
      event.preventDefault();
      if (event.repeat || held.has(event.code || key)) return;
      held.set(event.code || key, delta);
      path = [];
      pathInputAt = undefined;
      const from = playerPos.current ?? latest.current.state.playerPos;
      if (from) void stepTo({ x: from.x + delta.x, y: from.y + delta.y }, event.timeStamp);
      if (repeat === undefined) {
        repeat = window.setInterval(() => {
          const d = [...held.values()].at(-1);
          const p = playerPos.current;
          if (d && p && document.visibilityState === "visible") void stepTo({ x: p.x + d.x, y: p.y + d.y });
        }, STEP_MS);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      held.delete(event.code || key);
      if (held.size === 0) clearHeld();
    };

    void (async () => {
      try {
        const { createTiledMapView } = await import("@adventure/game-client/tiled-view");
        if (destroyed) return;
        showPosition(latest.current.state.playerPos);
        acknowledgedRevision.current = latest.current.state.revision;
        view = await createTiledMapView(parent, snapshot(), (point, inputAt) => goTo(point, inputAt), reduced.matches, {
          assetBase: ASSET_BASE,
          themeBase: "/game/themes",
          roomFallbackUrl: "/assets/curated/placeholder-landmark.png",
          defaultSprite: "Villager",
          onActor: (actorId) => latest.current.onTalk(actorId),
          onProp: (propId) => latest.current.onProp(propId),
          onLandmark: (landmarkId) => latest.current.onLandmark(landmarkId),
        });
        if (destroyed) {
          view.destroy();
          return;
        }
        render();
        intentHandlerRef.current?.(latest.current.intent);
        const canvas = parent.querySelector("canvas");
        canvas?.setAttribute("tabindex", "0");
        canvas?.setAttribute("aria-label", "Map. Use arrow keys or WASD to walk. Press Enter to talk, or click a tile to move.");
        // Walking works from anywhere on the page unless a field has focus, so the map never needs to be clicked first.
        document.addEventListener("keydown", onKey, { signal: controller.signal });
        document.addEventListener("keyup", onKeyUp, { signal: controller.signal });
        canvas?.focus({ preventScroll: true });
        window.addEventListener("blur", clearHeld, { signal: controller.signal });
        document.addEventListener("visibilitychange", clearHeld, { signal: controller.signal });
        reduced.addEventListener("change", (e) => view?.setReducedMotion(e.matches), { signal: controller.signal });
      } catch (error) {
        console.error("Map failed to start", error);
        const note = document.createElement("p");
        note.className = "p-4 text-sm text-muted";
        note.textContent = "The map could not start. You can still use the controls on the right.";
        parent.replaceChildren(note);
      }
    })();

    return () => {
      destroyed = true;
      intentHandlerRef.current = null;
      reconcileRef.current = null;
      controller.abort();
      clearHeld();
      if (sendTimer !== undefined) window.clearTimeout(sendTimer);
      window.clearInterval(walk);
      view?.destroy();
      renderRef.current = null;
      parent.replaceChildren();
    };
    // Re-mount only when the map itself changes (a new stage); state updates re-render via `renderRef`.
  }, [mapId]);

  // Re-draw on every state change; snap the player to the server's position if the server moved them (a new stage).
  useEffect(() => {
    reconcileRef.current?.(state);
    renderRef.current?.();
  }, [state, audio]);

  // Panel-driven intents.
  useEffect(() => {
    intentHandlerRef.current?.(intent);
  }, [intent]);

  return <div ref={host} className="absolute inset-0 overflow-hidden bg-[#4f5d3a]" />;
}
