"use client";

/**
 * The map: `@adventure/game-core` decides what is walkable, `@adventure/game-client`
 * draws it. The client owns the walk between tiles; the server owns which room
 * the player is in. Crossing into a room posts `move_room`; if the server refuses
 * (a closed door, a stale stage), the player is put back.
 *
 * Agents have no tiles server-side, only rooms, so each is drawn at a stable
 * interior tile of its current room.
 */
import {
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
import { OUTDOORS_ROOM_ID, type PlayState } from "@/lib/play/session";

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

export type MapIntent = { kind: "room"; roomId: string } | { kind: "point"; point: Point } | null;

export interface MapCanvasProps {
  state: PlayState;
  /** Sound on/off and keyed one-shot cues; the renderer plays each key once. */
  audio: { muted: boolean; cues: { key: string; id: SoundCueId }[] };
  /** Where the player wants to go, set by the panel ("Walk to the bazaar"). Cleared by the canvas when reached. */
  intent: MapIntent;
  onIntentDone: () => void;
  /** The player stepped into a room the server does not know they are in. Resolve to false to put them back. */
  onEnterRoom: (roomId: string, position: Point) => Promise<boolean>;
  /** The player stopped somewhere; remember it for resume. */
  onSettled: (position: Point) => void;
  /** The player is standing outside a closed door. */
  onWaitingAtDoor: (roomId: string | null) => void;
}

function doorsOf(state: PlayState): Record<string, DoorState> {
  return Object.fromEntries(state.rooms.map((room) => [`door:${room.id}`, room.doorOpen ? "open" : "closed"]));
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

export function MapCanvas({ state, audio, intent, onIntentDone, onEnterRoom, onSettled, onWaitingAtDoor }: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, audio, intent, onIntentDone, onEnterRoom, onSettled, onWaitingAtDoor });
  latest.current = { state, audio, intent, onIntentDone, onEnterRoom, onSettled, onWaitingAtDoor };
  const playerPos = useRef<Point | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

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
    let pendingRoom: string | null = null;
    let settleTimer: number | undefined;
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
            const position = (a.roomId ? seatIn(map as StageMap, a.roomId, n + 1) : outdoorSeat(map as StageMap, n)) ?? { x: 1, y: 1 };
            return { id: a.id, name: a.name, position, space: spaceAt(map as StageMap, position), targetRoomId: null, status: "idle" as const, ...(a.sprite ? { sprite: a.sprite } : {}) };
          }),
      ];
      const goal = path.length ? { kind: "point" as const, point: path[path.length - 1]! } : null;
      return {
        seed: "",
        map: map as StageMap,
        doors,
        actors,
        playerGoal: goal,
        playerStatus: path.length ? ("moving" as const) : ("idle" as const),
        running: true,
        npcRoutes: false,
        revision: s.revision,
        roomNames: Object.fromEntries(s.rooms.map((r) => [r.id, r.name])),
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

    const settle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (playerPos.current) latest.current.onSettled(playerPos.current);
      }, 800);
    };

    const stepTo = async (to: Point) => {
      const s = latest.current.state;
      const from = playerPos.current ?? s.playerPos;
      if (!from) return;
      const doors = doorsOf(s);
      if (!canStep(map as StageMap, doors, from, to)) {
        // Walked into a closed door: stop and offer a knock.
        const door = map.doors.find((d) => d.position.x === to.x && d.position.y === to.y);
        if (door && doors[door.id] === "closed") latest.current.onWaitingAtDoor(door.roomId);
        path = [];
        render();
        return;
      }
      const ddx = to.x - from.x;
      const ddy = to.y - from.y;
      facing = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? "right" : "left") : ddy > 0 ? "down" : "up";
      playerPos.current = to;
      render();
      const space = spaceAt(map as StageMap, to);
      // Doorways belong to nobody; grass and path are the outdoors, which the server tracks as a room of its own.
      const roomId = space?.kind === "room" ? space.roomId : space?.kind === "outdoor" ? OUTDOORS_ROOM_ID : null;
      const serverRoom = s.currentRoomId ?? OUTDOORS_ROOM_ID;
      if (roomId && roomId !== serverRoom && pendingRoom !== roomId) {
        pendingRoom = roomId;
        const accepted = await latest.current.onEnterRoom(roomId, to);
        pendingRoom = null;
        if (!accepted) {
          const door = map.doors.find((d) => d.roomId === roomId);
          playerPos.current = door ? door.outside : from;
          path = [];
          render();
        }
      }
      if (space?.kind === "room") latest.current.onWaitingAtDoor(null);
      settle();
    };

    const walk = window.setInterval(() => {
      if (document.visibilityState !== "visible" || path.length === 0) return;
      const next = path.shift()!;
      void stepTo(next);
      if (path.length === 0) latest.current.onIntentDone();
    }, STEP_MS);

    const goTo = (target: Point) => {
      const from = playerPos.current ?? latest.current.state.playerPos;
      if (!from) return;
      const doors = doorsOf(latest.current.state);
      const found = findPath(map as StageMap, doors, from, target);
      if (!found) {
        // Aim for the doorstep of a closed room, so the player can knock.
        const door = map.doors.find((d) => d.position.x === target.x && d.position.y === target.y || (d.inside.x === target.x && d.inside.y === target.y));
        const fallback = door ? findPath(map as StageMap, doors, from, door.outside) : null;
        path = fallback ?? [];
        if (door && fallback) latest.current.onWaitingAtDoor(door.roomId);
      } else {
        path = found;
      }
      render();
    };
    const goToRoom = (roomId: string) => {
      const door = map.doors.find((d) => d.roomId === roomId);
      if (!door) return;
      const doors = doorsOf(latest.current.state);
      goTo(isWalkable(map as StageMap, doors, door.position) ? door.inside : door.outside);
    };
    (parent as HTMLDivElement & { __goToRoom?: (id: string) => void }).__goToRoom = goToRoom;

    const clearHeld = () => {
      held.clear();
      if (repeat !== undefined) window.clearInterval(repeat);
      repeat = undefined;
    };
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || typing(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const delta = KEYS[key];
      if (!delta) return;
      event.preventDefault();
      if (event.repeat || held.has(event.code || key)) return;
      held.set(event.code || key, delta);
      path = [];
      const from = playerPos.current ?? latest.current.state.playerPos;
      if (from) void stepTo({ x: from.x + delta.x, y: from.y + delta.y });
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
        playerPos.current = latest.current.state.playerPos;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        view = await createTiledMapView(parent, snapshot(), (point) => goTo(point), reduced.matches, { assetBase: ASSET_BASE, defaultSprite: "Villager" });
        if (destroyed) {
          view.destroy();
          return;
        }
        render();
        const canvas = parent.querySelector("canvas");
        canvas?.setAttribute("tabindex", "0");
        canvas?.setAttribute("aria-label", "Settlement map. Use the arrow keys or WASD to walk; click a tile to walk there.");
        // Walking works from anywhere on the page unless a field has focus, so the map never needs to be clicked first.
        document.addEventListener("keydown", onKey, { signal: controller.signal });
        document.addEventListener("keyup", onKeyUp, { signal: controller.signal });
        canvas?.focus({ preventScroll: true });
        window.addEventListener("blur", clearHeld, { signal: controller.signal });
        reduced.addEventListener("change", (e) => view?.setReducedMotion(e.matches), { signal: controller.signal });
      } catch (error) {
        const note = document.createElement("p");
        note.className = "p-4 text-sm opacity-70";
        note.textContent = `The map could not start (${error instanceof Error ? error.message : "unknown error"}). The controls on the right still work.`;
        parent.replaceChildren(note);
      }
    })();

    return () => {
      destroyed = true;
      controller.abort();
      clearHeld();
      window.clearInterval(walk);
      window.clearTimeout(settleTimer);
      view?.destroy();
      renderRef.current = null;
      parent.replaceChildren();
    };
    // Re-mount only when the map itself changes (a new stage); state updates re-render via `renderRef`.
  }, [mapId]);

  // Re-draw on every state change; snap the player to the server's position if the server moved them (a new stage).
  useEffect(() => {
    if (state.playerPos && playerPos.current === null) playerPos.current = state.playerPos;
    renderRef.current?.();
  }, [state, audio]);

  // Panel-driven intents.
  useEffect(() => {
    if (!intent || !host.current) return;
    const goToRoom = (host.current as HTMLDivElement & { __goToRoom?: (id: string) => void }).__goToRoom;
    if (intent.kind === "room") goToRoom?.(intent.roomId);
  }, [intent]);

  return <div ref={host} className="absolute inset-0 overflow-hidden bg-[#4f5d3a]" />;
}
