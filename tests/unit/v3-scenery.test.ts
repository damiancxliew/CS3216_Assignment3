import { describe, expect, it } from "vitest";
import { findPath, roomInterior } from "@adventure/game-core";
import { compileV3StageMap } from "@/lib/play/v3/map";
import { v3AdventureScenery, v3Atmosphere, v3RoomFixtures, v3Environment } from "@/lib/play/v3/scenery";
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


describe("v2-style outdoor scenery for v3", () => {
  it.each(["A river village", "A harbour quay", "An industrial factory", "A desert oasis"])("supplies street stops without disconnecting rooms: %s", (storyContext) => {
    const rooms = [{ id: "a", name: "First room" }, { id: "b", name: "Second room" }];
    const scenery = { storyContext, roomDescriptions: { a: storyContext, b: "A council table" } };
    const environment = v3Environment(scenery)!;
    const { map, playerSpawn, initialDoors } = compileV3StageMap("scenery-test", "s", 0, rooms, "a", scenery);
    expect(map.scenery!.length).toBeGreaterThan(0);
    expect(map.scenery!.every(prop => environment.props.includes(prop.kind))).toBe(true);
    for (const door of map.doors) expect(findPath(map, initialDoors, playerSpawn, door.inside)).not.toBeNull();
  });
  it("uses the existing resident/trader/worker population categories", () => {
    const plan = (storyContext: string) => v3Environment({ storyContext, roomDescriptions: {} });
    expect(plan("village")?.population).toBe("residents");
    expect(plan("harbour")?.population).toBe("traders");
    expect(plan("factory")?.population).toBe("workers");
    expect(v3Environment()).toBeUndefined();
  });
});
