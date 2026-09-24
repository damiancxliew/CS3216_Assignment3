import { isWalkable, type DoorState, type Point, type StageMap } from "@adventure/game-core";

const CARDINAL_STEPS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

/** True when a tile belongs to the NPC's assigned location, without crossing its boundary. */
export function isInsideLocation(map: StageMap, roomId: string, point: Point): boolean {
  const room = map.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return false;
  if (room.enclosure === "open") {
    return point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height;
  }
  return point.x > room.x && point.x < room.x + room.width - 1 && point.y > room.y && point.y < room.y + room.height - 1;
}

/**
 * Pick one cosmetic NPC step. It never crosses the authored location boundary,
 * walks through a closed door, or enters a tile occupied by another marker.
 */
export function chooseRoomWanderStep(
  map: StageMap,
  doors: Readonly<Record<string, DoorState>>,
  roomId: string,
  from: Point,
  blocked: ReadonlySet<string>,
  random: () => number = Math.random,
): Point {
  const candidates = CARDINAL_STEPS
    .map((step) => ({ x: from.x + step.x, y: from.y + step.y }))
    .filter((point) => isInsideLocation(map, roomId, point) && isWalkable(map, doors, point) && !blocked.has(pointKey(point)));

  if (candidates.length === 0) return from;
  const roll = Math.max(0, Math.min(0.999999, random()));
  return candidates[Math.floor(roll * candidates.length)]!;
}
