import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spaceAt } from "@adventure/game-core";

import { compileV3StageMap, roomIdToEnter, seatIn, v3DocumentProps, v3StageLayout } from "@/lib/play/v3/map";
import type { PlayerView } from "@adventure/play-contract";

const golden = JSON.parse(readFileSync(new URL("../../fixtures/golden-1819.json", import.meta.url), "utf8")) as {
  stages: Array<{ rooms: Array<{ id: string; name: string }> }>;
};
const rooms: PlayerView["rooms"] = golden.stages[0]!.rooms;
const stageId = "stage-0";
const spawnRoomId = rooms[0]!.id;

describe("v3 stage map layout", () => {
  it("compiles every golden-1819 room with stable, doorless geometry", () => {
    const layout = v3StageLayout(stageId, rooms, spawnRoomId);
    const first = compileV3StageMap("attempt-one", stageId, 0, rooms, spawnRoomId);
    const sameAttempt = compileV3StageMap("attempt-one", stageId, 0, rooms, spawnRoomId);
    const otherAttempt = compileV3StageMap("attempt-two", stageId, 0, rooms, spawnRoomId);

    expect(layout.placements).toEqual([]);
    expect(layout.spawnRoomId).toBe(spawnRoomId);
    expect(layout.rooms).toEqual(rooms.map(({ id }) => ({
      id,
      size: "medium",
      enclosure: "enclosed",
      doorDefault: null,
    })));
    expect(layout).not.toHaveProperty("landmarks");
    expect(layout).not.toHaveProperty("landscape");
    expect(first.map.rooms.map((room) => room.id).sort()).toEqual(rooms.map((room) => room.id).sort());
    expect(first.map.doorless).toBe(true);
    expect(Object.values(first.initialDoors).every((state) => state === "open")).toBe(true);
    expect(first.map.doors.every((door) => first.initialDoors[door.id] === "open")).toBe(true);
    expect(sameAttempt.map.id).toBe(first.map.id);
    expect(otherAttempt.map.id).not.toBe(first.map.id);
  });

  it("identifies a room transition only when the player enters a different room", () => {
    const compiled = compileV3StageMap("attempt-one", stageId, 0, rooms, spawnRoomId);
    const nextRoom = compiled.map.rooms.find((room) => room.id !== spawnRoomId)!;
    const interior = { x: nextRoom.x + 1, y: nextRoom.y + 1 };

    expect(roomIdToEnter(compiled.map, interior, spawnRoomId)).toBe(nextRoom.id);
    expect(roomIdToEnter(compiled.map, interior, nextRoom.id)).toBeNull();
    expect(roomIdToEnter(compiled.map, { x: 0, y: 0 }, spawnRoomId)).toBeNull();
  });

  it("seats only the provided current-room documents after the characters", () => {
    const compiled = compileV3StageMap("attempt-one", stageId, 0, rooms, spawnRoomId);
    const documents = [
      { id: "letter", kind: "letter", title: "A letter" },
      { id: "minutes", kind: "minutes", title: "Council minutes" },
    ] as PlayerView["documentsHere"];
    const props = v3DocumentProps(compiled.map, spawnRoomId, documents, 3);

    expect(props.map(({ id }) => id)).toEqual(["letter", "minutes"]);
    expect(props.map(({ name }) => name)).toEqual(["A letter", "Council minutes"]);
    expect(props.every(({ found }) => !found)).toBe(true);
    expect(props.map(({ position }) => position)).toEqual([
      seatIn(compiled.map, spawnRoomId, 3),
      seatIn(compiled.map, spawnRoomId, 4),
    ]);
    expect(props.every(({ position }) => {
      const space = spaceAt(compiled.map, position);
      return space?.kind === "room" && space.roomId === spawnRoomId;
    })).toBe(true);
  });
});
