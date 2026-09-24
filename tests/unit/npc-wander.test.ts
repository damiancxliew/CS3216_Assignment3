import { compileStage, type Point } from "@adventure/game-core";
import { describe, expect, it } from "vitest";

import { chooseRoomWanderStep, isInsideLocation, pointKey } from "@/lib/play/npc-wander";

const compiled = compileStage({
  stageId: "wander-stage",
  spawnRoomId: "office",
  rooms: [
    { id: "office", size: "medium", enclosure: "enclosed", doorDefault: "open" },
    { id: "archive", size: "small", enclosure: "enclosed", doorDefault: "open" },
  ],
  placements: [
    { id: "npc", kind: "actor", roomId: "office" },
    { id: "decision", kind: "decision", roomId: "archive" },
  ],
}, "wander-test");

describe("cosmetic NPC wandering", () => {
  it("moves one tile at a time without leaving the assigned room", () => {
    let position = compiled.placements.find((entry) => entry.id === "npc")!.position;
    for (let index = 0; index < 100; index += 1) {
      const before = position;
      position = chooseRoomWanderStep(compiled.map, compiled.initialDoors, "office", position, new Set(), () => (index % 4) / 4);
      expect(Math.abs(position.x - before.x) + Math.abs(position.y - before.y)).toBeLessThanOrEqual(1);
      expect(isInsideLocation(compiled.map, "office", position)).toBe(true);
    }
  });

  it("stays put when every neighbouring tile is occupied", () => {
    const position = compiled.placements.find((entry) => entry.id === "npc")!.position;
    const blocked = new Set<Point>([
      { x: position.x, y: position.y - 1 },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
      { x: position.x - 1, y: position.y },
    ].map((point) => point));
    expect(chooseRoomWanderStep(compiled.map, compiled.initialDoors, "office", position, new Set([...blocked].map(pointKey)))).toEqual(position);
  });
});
