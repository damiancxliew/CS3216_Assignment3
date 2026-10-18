import { compileStage, roomInterior, spaceAt, type CompiledStage, type Point, type StageLayoutInput, type StageMap } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { PlayerView } from "@adventure/play-contract";

import { layoutSeed } from "@/lib/play/layout";

type V3Room = PlayerView["rooms"][number];

const COMPILER_ANCHOR_ID = "v3-map-layout-anchor";

export function v3StageLayout(stageId: string, rooms: readonly V3Room[], spawnRoomId: string): StageLayoutInput {
  return {
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
): Pick<CompiledStage, "map" | "playerSpawn" | "initialDoors"> {
  const layout = v3StageLayout(stageId, rooms, spawnRoomId);
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
  return space?.kind === "room" && space.roomId !== currentRoomId ? space.roomId : null;
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

export function v3DocumentProps(
  map: StageMap,
  roomId: string | null,
  documents: PlayerView["documentsHere"],
  firstSeat: number,
): NonNullable<PlaygroundSnapshot["props"]> {
  return documents.flatMap((document, index) => {
    const position = seatIn(map, roomId, firstSeat + index);
    return position ? [{ id: document.id, name: document.title, position, found: false }] : [];
  });
}
