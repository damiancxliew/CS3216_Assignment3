import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { findPath, isWalkable, spaceAt } from "@adventure/game-core";
import {
  demoScenery,
  newDemoV3State,
  projectDemoV3,
  restoreDemoV3State,
} from "../apps/web/src/lib/demo/v3-session";
import {
  compileV3StageMap,
  roomIdToEnter,
  seatIn,
  v3DocumentProps,
} from "../apps/web/src/lib/play/v3/map";
import { stages } from "../apps/web/src/lib/demo/lim-bo-seng";

describe("authored history maps on the v3 engine", () => {
  it("makes the waterfront compact and keeps its boarding point reachable", () => {
    const scene = demoScenery[0].authored;
    expect(scene.map.width * scene.map.height).toBeLessThan(42 * 36 * 0.52);
    expect(
      findPath(scene.map, scene.initialDoors, scene.playerSpawn, {
        x: 27,
        y: 18,
      }),
    ).not.toBeNull();
    expect(spaceAt(scene.map, { x: 27, y: 18 })).toEqual({
      kind: "outdoor",
      locationId: "street",
    });
    expect(scene.cast).toEqual([]);
  });
  it.each(stages.map((stage, index) => [stage.title, index] as const))(
    "keeps every interaction reachable in %s",
    (_, index) => {
      const scene = demoScenery[index];
      const { map, initialDoors, playerSpawn, fixtures } = scene.authored;
      const state = { ...newDemoV3State(), stage: index };
      expect(map.rooms).toHaveLength(index === 0 ? 1 : 3);
      expect(map.width * map.height).toBeLessThan(42 * 36 * 0.52);
      expect(scene.authored.desktopCamera).toBe("cover");
      expect(scene.authored.cast?.map((n) => n.id)).toEqual(
        index === 0 ? [] : stages[index].npcs.map((n) => n.id),
      );
      expect(
        findPath(map, initialDoors, playerSpawn, { x: 27, y: 18 }),
      ).not.toBeNull();
      expect(
        (spaceAt(map, { x: 27, y: 18 }) as { locationId?: string })?.locationId,
      ).toBe(index === 0 ? "street" : map.rooms[1].id);
      expect(map.landmarks!.length).toBeGreaterThan(20);
      expect(isWalkable(map, initialDoors, playerSpawn)).toBe(true);
      for (const room of map.rooms) {
        const center = seatIn(map, room.id, 0)!;
        expect(
          findPath(map, initialDoors, playerSpawn, center),
          room.id,
        ).not.toBeNull();
        expect(roomIdToEnter(map, center, null)).toBe(room.id);
        const view = projectDemoV3({ ...state, room: room.id });
        const targets = [
          ...view.characters.map((_, i) => seatIn(map, room.id, i + 1)!),
          ...v3DocumentProps(
            map,
            room.id,
            view.documentsHere,
            view.characters.length + 1,
          ).map((prop) => prop.position),
        ];
        for (const point of targets) {
          expect(
            isWalkable(map, initialDoors, point),
            `${room.id}: ${JSON.stringify(point)}`,
          ).toBe(true);
          expect(
            findPath(map, initialDoors, playerSpawn, point),
          ).not.toBeNull();
          expect(spaceAt(map, point)).toEqual({
            kind: "outdoor",
            locationId: room.id,
          });
        }
      }
      for (const fixture of fixtures)
        expect(
          existsSync(`apps/web/public${fixture.imageUrl}`),
          fixture.imageUrl,
        ).toBe(true);
      // Furniture and façades are real obstacles, not images the player walks through.
      for (const fixture of map.landmarks!)
        expect(
          isWalkable(map, initialDoors, { x: fixture.x, y: fixture.y }),
        ).toBe(false);
      for (const url of [
        scene.authored.playerSheet,
        ...Object.values(scene.authored.characterSheets!),
      ])
        expect(existsSync(`apps/web/public${url}`)).toBe(true);
    },
  );
  it("uses hand-authored geometry only when explicitly supplied", () => {
    const view = projectDemoV3(newDemoV3State());
    const authored = compileV3StageMap(
      "demo",
      "departure",
      0,
      view.rooms,
      view.currentRoomId!,
      demoScenery[0],
    );
    expect(authored.map).toBe(demoScenery[0].authored.map);
    const generated = compileV3StageMap(
      "normal",
      "departure",
      0,
      view.rooms,
      view.currentRoomId!,
    );
    expect(generated.map.id).not.toBe(authored.map.id);
    expect(
      generated.map.rooms.every((room) => room.enclosure === "enclosed"),
    ).toBe(true);
  });
  it("keeps pre-merge demo progress when journal messages lack stageIndex", () => {
    const state = newDemoV3State();
    const raw = JSON.parse(JSON.stringify(state));
    delete raw.messages[0].stageIndex;
    raw.revision = 12;
    const restored = restoreDemoV3State(JSON.stringify(raw));
    expect(restored.revision).toBe(12);
    expect(restored.messages[0].stageIndex).toBeNull();
    expect(projectDemoV3(restored).speakers[0].name).toBe("Lim Bo Seng");
  });
});

it("preserves old progress and exports fictional dialogue without relabelling it", () => {
  const state = newDemoV3State();
  const old = {
    ...state,
    castEdition: undefined,
    revision: 12,
    intro: false,
    messages: [
      {
        ...state.messages[0],
        characterId: "mei",
        text: "Old fictional dialogue",
      },
    ],
  };
  const restored = restoreDemoV3State(JSON.stringify(old));
  expect(restored.revision).toBe(12);
  expect(restored.intro).toBe(false);
  expect(restored.previousEditionMessages?.[0].text).toBe(
    "Old fictional dialogue",
  );
  expect(
    restored.messages.every((message) => message.characterId === "lim"),
  ).toBe(true);
  expect(
    restored.messages.some((message) => message.text.includes("Old fictional")),
  ).toBe(false);
  expect(restoreDemoV3State(JSON.stringify(restored))).toEqual(restored);
});

import { demoCinematics } from "../apps/web/src/lib/demo/cinematics";
it("introduces every stage's cast with real photographs linked to matching sprites", () => {
  for (const [index, stage] of stages.entries()) {
    const people = demoCinematics.stages[index].filter((beat) =>
      beat.id.startsWith("person-"),
    );
    expect(people.map((p) => p.title)).toEqual(stage.npcs.map((n) => n.name));
    expect(new Set(people.map((p) => p.image?.src)).size).toBe(
      stage.npcs.length,
    );
    for (const beat of people)
      expect(existsSync(`apps/web/public${beat.image!.src}`)).toBe(true);
  }
});
