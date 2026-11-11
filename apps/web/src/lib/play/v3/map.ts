import { documentMapLabel } from './document-labels';
import { compileStage, roomInterior, spaceAt, type CompiledStage, type Point, type StageLayoutInput, type StageMap } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { PlayerView } from "@adventure/play-contract";

import { layoutSeed } from "@/lib/play/layout";

import { v3Environment, type V3StageScenery } from "./scenery";

type V3Room = PlayerView["rooms"][number];

const COMPILER_ANCHOR_ID = "v3-map-layout-anchor";

export function v3StageLayout(stageId: string, rooms: readonly V3Room[], spawnRoomId: string, scenery?: V3StageScenery): StageLayoutInput {
  const environment = v3Environment(scenery);
  return {
    ...(environment ? { landscape: { layout: environment.layout ?? "meandering", water: environment.waterfront }, scenery: { palette: environment.props, density: environment.propDensity } } : {}),
    stageId,
    spawnRoomId,
    rooms: rooms.map(({ id }) => ({
      id,
      size: "medium",
      enclosure: "enclosed",
      doorDefault: null,
    })),
    placements: [],
  };
}

export function compileV3StageMap(
  attemptId: string,
  stageId: string,
  stageIndex: number,
  rooms: readonly V3Room[],
  spawnRoomId: string,
  scenery?: V3StageScenery,
): Pick<CompiledStage, "map" | "playerSpawn" | "initialDoors"> {
  if (scenery?.authored) {
    const { map, playerSpawn, initialDoors } = scenery.authored;
    return { map, playerSpawn, initialDoors };
  }
  const layout = v3StageLayout(stageId, rooms, spawnRoomId, scenery);
  const compiled = compileStage({
    ...layout,
    placements: [{ id: COMPILER_ANCHOR_ID, kind: "decision", roomId: spawnRoomId }],
  }, layoutSeed(attemptId, stageIndex), { doors: false });

  return {
    map: compiled.map,
    playerSpawn: compiled.playerSpawn,
    initialDoors: compiled.initialDoors,
  };
}

export function roomIdToEnter(map: StageMap, point: Point, currentRoomId: string | null): string | null {
  const space = spaceAt(map, point);
  const roomId = space?.kind === "room" ? space.roomId : space?.kind === "outdoor" ? space.locationId : null;
  return roomId && roomId !== currentRoomId ? roomId : null;
}

export function nearbyCharacterId(
  player: Point,
  facing: "up" | "down" | "left" | "right",
  seats: readonly { id: string; position: Point }[],
): string | null {
  const direction: Point = facing === "up"
    ? { x: 0, y: -1 }
    : facing === "down"
      ? { x: 0, y: 1 }
      : facing === "left"
        ? { x: -1, y: 0 }
        : { x: 1, y: 0 };
  const faced = { x: player.x + direction.x, y: player.y + direction.y };
  const nearby = seats.filter(({ position }) =>
    Math.max(Math.abs(position.x - player.x), Math.abs(position.y - player.y)) <= 1,
  );
  const inFront = nearby.find(({ position }) => position.x === faced.x && position.y === faced.y);
  if (inFront) return inFront.id;
  if (nearby.length === 0) return null;

  let closest = nearby[0]!;
  let closestDistance = Math.abs(closest.position.x - player.x) + Math.abs(closest.position.y - player.y);
  for (const seat of nearby.slice(1)) {
    const distance = Math.abs(seat.position.x - player.x) + Math.abs(seat.position.y - player.y);
    if (distance < closestDistance) {
      closest = seat;
      closestDistance = distance;
    }
  }
  return closest.id;
}

export function seatIn(map: StageMap, roomId: string | null, index: number): Point | null {
  const room = map.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return null;
  const interior: Point[] = [];
  for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
    for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
      const point = { x, y };
      if (roomInterior(room, point)) interior.push(point);
    }
  }
  const center = { x: room.x + room.width / 2, y: room.y + room.height / 2 };
  interior.sort((left, right) =>
    Math.hypot(left.x - center.x, left.y - center.y) - Math.hypot(right.x - center.x, right.y - center.y)
    || left.y - right.y
    || left.x - right.x,
  );
  return interior[index % interior.length] ?? null;
}

/** Where the player stands on arriving in a room: just inside its door, clear of the people seated in the middle. */
export function arrivalPoint(map: StageMap, roomId: string | null): Point | null {
  const door = map.doors.find((candidate) => candidate.roomId === roomId);
  return door?.inside ?? seatIn(map, roomId, 0);
}

export function v3DocumentProps(
  map: StageMap,
  roomId: string | null,
  documents: PlayerView["documentsHere"],
  firstSeat: number,
): NonNullable<PlaygroundSnapshot["props"]> {
  return documents.flatMap((document, index) => {
    const position = seatIn(map, roomId, firstSeat + index);
    return position ? [{ id: document.id, name: documentMapLabel(document.title), position, found: document.read }] : [];
  });
}

export function unreadDocumentAt(
  props: NonNullable<PlaygroundSnapshot["props"]>,
  point: Point,
): string | null {
  return props.find(({ found, position }) => !found && position.x === point.x && position.y === point.y)?.id ?? null;
}

/** The room or outdoor location a map point belongs to, if any. */
export function placeAt(map: StageMap, point: Point): string | null {
  const space = spaceAt(map, point);
  return space?.kind === "room" ? space.roomId : space?.kind === "outdoor" ? space.locationId ?? null : null;
}

export interface RoomEntrySync {
  /** Report the place the player now stands in, after every step. Sends room entries in order without blocking movement. */
  arrive(place: string | null): void;
  /** Adopt the server's room after it changed outside this map (only while nothing is in flight). */
  sync(): void;
  /** True while an entry is in flight, so the visible occupants may still belong to the previous room. */
  pending(): boolean;
  /** The last room asked for (or confirmed): the room the player is treated as being in for new entries. */
  claimed(): string | null;
  destroy(): void;
}

/**
 * Keeps engine room entries in step with free movement under latency. At most one entry is in flight; later
 * rooms coalesce into the most recent one and are sent, in order, when it settles. A rejected entry never moves
 * the player: they stay put, the claim falls back to the server's room, and the same room is retried when the
 * player steps out of it and back in, or takes another step there once `retryAfterMs` has passed.
 */
export function createRoomEntrySync(options: {
  enter: (roomId: string) => Promise<boolean>;
  serverRoom: () => string | null;
  place: () => string | null;
  onSettled: () => void;
  retryAfterMs?: number;
  now?: () => number;
}): RoomEntrySync {
  const now = options.now ?? Date.now;
  let claimed = options.serverRoom();
  let inFlight: string | null = null;
  let queued: string | null = null;
  let refused: string | null = null;
  let refusedAt = 0;
  let destroyed = false;

  const request = (roomId: string) => {
    claimed = roomId;
    if (inFlight !== null) {
      queued = roomId;
      return;
    }
    void send(roomId);
  };

  const send = async (roomId: string) => {
    inFlight = roomId;
    let accepted = false;
    try {
      accepted = await options.enter(roomId);
    } catch {
      accepted = false;
    }
    if (destroyed) return;
    inFlight = null;
    const next = queued;
    queued = null;
    if (accepted) {
      if (next !== null && next !== roomId) request(next);
    } else {
      claimed = options.serverRoom();
      refused = options.place() === roomId ? roomId : null;
      refusedAt = now();
      if (next !== null && next !== roomId && next !== claimed) request(next);
    }
    options.onSettled();
  };

  return {
    arrive(place) {
      if (refused !== null && (place !== refused || now() - refusedAt >= (options.retryAfterMs ?? 2_000))) refused = null;
      if (place !== null && place !== claimed && place !== refused) request(place);
    },
    sync() {
      if (inFlight === null) claimed = options.serverRoom();
    },
    pending: () => inFlight !== null,
    claimed: () => claimed,
    destroy() {
      destroyed = true;
    },
  };
}

export interface HeldKeyMover {
  /** A fresh key press: steps once now, then auto-repeats only if the key is still held after the initial delay. */
  press(code: string, direction: Point): void;
  release(code: string): void;
  /** Forget every held key and stop repeating (blur, hidden tab, a dialog taking over). */
  clear(): void;
  active(): boolean;
}

/** One tap moves exactly one tile; holding walks after a short delay, like a game pad. */
export function createHeldKeyMover(options: {
  step: (direction: Point) => void;
  canRepeat: () => boolean;
  initialDelayMs?: number;
  intervalMs?: number;
}): HeldKeyMover {
  const held = new Map<string, Point>();
  let delay: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (delay !== undefined) clearTimeout(delay);
    if (interval !== undefined) clearInterval(interval);
    delay = undefined;
    interval = undefined;
  };
  const clear = () => {
    held.clear();
    stop();
  };
  const repeatStep = () => {
    const direction = [...held.values()].at(-1);
    if (!direction || !options.canRepeat()) {
      clear();
      return;
    }
    options.step(direction);
  };

  return {
    press(code, direction) {
      if (held.has(code)) return;
      held.set(code, direction);
      options.step(direction);
      // Restart the delay on every new key, so a second key's own step is never followed by an instant repeat.
      stop();
      delay = setTimeout(() => {
        delay = undefined;
        repeatStep();
        if (held.size > 0) interval = setInterval(repeatStep, options.intervalMs ?? 160);
      }, options.initialDelayMs ?? 240);
    },
    release(code) {
      held.delete(code);
      if (held.size === 0) stop();
    },
    clear,
    active: () => held.size > 0 || delay !== undefined || interval !== undefined,
  };
}
