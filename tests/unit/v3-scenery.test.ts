import { describe, expect, it } from "vitest";
import { roomInterior } from "@adventure/game-core";
import { compileV3StageMap } from "@/lib/play/v3/map";
import { v3AdventureScenery, v3Atmosphere, v3RoomFixtures } from "@/lib/play/v3/scenery";
import type { EngineSpec } from "@adventure/engine";

describe("v3 public map scenery", () => {
  it("projects only room descriptions and public time/place/title, excluding story secrets", () => {
    const stage = {
      title: "At the harbour", timePlace: "Singapore, 1819", openingNarration: "FUTURE OPENING",
      centralQuestion: "QUESTION", rooms: [{ id: "office", name: "Office", description: "A telegraph and filing cabinet" }],
      situations: [{ openingNarration: "SECRET OUTCOME" }], placement: { hidden: "office" },
    };
    const scenery = v3AdventureScenery({ stages: [stage] } as unknown as EngineSpec);
    expect(scenery).toEqual([{
      roomDescriptions: { office: "A telegraph and filing cabinet" },
      storyContext: "Singapore, 1819 At the harbour",
    }]);
    expect(JSON.stringify(scenery)).not.toMatch(/SECRET|FUTURE|QUESTION|hidden/);
  });

  it.each([
    ["Rainy harbour at night", "rain"], ["Thunder over the camp", "thunderstorm"],
    ["A snowy street", "snow"], ["Snow in the square", "snow"], ["Moonlit quay", "night"],
    ["A misty morning", "fog"], ["Singapore, 1819", "clear"],
  ])("chooses weather for %s", (setting, id) => {
    expect(v3Atmosphere(setting).id).toBe(id);
  });

  it("places bundled fixtures wholly inside rooms without changing map geometry", () => {
    const rooms = [{ id: "office", name: "Records office" }, { id: "hall", name: "Council" }];
    const { map } = compileV3StageMap("a", "s", 0, rooms, "office");
    const before = JSON.stringify(map);
    const fixtures = v3RoomFixtures(map, { storyContext: "Singapore", roomDescriptions: {
      office: "Filing cabinet and records", hall: "A long council table",
    } });
    expect(fixtures).toHaveLength(2);
    for (const fixture of fixtures) {
      const room = map.rooms.find(({ id }) => id === fixture.roomId)!;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        expect(roomInterior(room, { x: fixture.position.x + x, y: fixture.position.y + y })).toBe(true);
      }
    }
    expect(Object.fromEntries(fixtures.map(({ roomId, kind }) => [roomId, kind]))).toEqual({ office: "shelf", hall: "table" });
    expect(JSON.stringify(map)).toBe(before);
    expect(v3RoomFixtures(map)).toEqual([]);
  });
});
