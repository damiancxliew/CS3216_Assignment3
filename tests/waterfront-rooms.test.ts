import { describe, expect, it } from "vitest";
import { findPath, isWalkable } from "@adventure/game-core";
import {
  buildWaterfrontMap,
  WATERFRONT_DOORS,
} from "../apps/web/src/lib/demo/waterfront-map";
import { buildWaterfrontInterior } from "../apps/web/src/lib/demo/waterfront-interiors";
import {
  newDemoV3State,
  projectDemoV3,
} from "../apps/web/src/lib/demo/v3-session";
import { seatIn, v3DocumentProps } from "../apps/web/src/lib/play/v3/map";

describe("connected waterfront spaces", () => {
  it("keeps household belongings indoors and all street doorways reachable", () => {
    const scene = buildWaterfrontMap("departure", ["lim", "gan", "elizabeth"]);
    expect(
      scene.fixtures.some((f) =>
        ["water-jars", "waterfront-supplies"].includes(f.id),
      ),
    ).toBe(false);
    expect(scene.map.rooms.map((r) => r.id)).toEqual(["street"]);
    for (const door of WATERFRONT_DOORS)
      expect(
        findPath(scene.map, scene.initialDoors, scene.playerSpawn, door.point),
      ).not.toBeNull();
  });
  it.each(["household", "quay", "records"])(
    "provides a walkable %s interior with people, records and a return exit",
    (room) => {
      const scene = buildWaterfrontInterior(room);
      const view = projectDemoV3({ ...newDemoV3State(), room });
      expect(view.characters).toHaveLength(1);
      const targets = [
        { x: 12, y: 14 },
        { x: 13, y: 14 },
        seatIn(scene.map, room, 1)!,
        ...v3DocumentProps(scene.map, room, view.documentsHere, 2).map(
          (p) => p.position,
        ),
      ];
      for (const target of targets) {
        expect(isWalkable(scene.map, scene.initialDoors, target)).toBe(true);
        expect(
          findPath(scene.map, scene.initialDoors, scene.playerSpawn, target),
        ).not.toBeNull();
      }
      if (room === "quay")
        expect(scene.fixtures.map((f) => f.id)).toEqual(
          expect.arrayContaining(["water-jars", "waterfront-supplies"]),
        );
    },
  );
  it("shows no indoor historical figures on the street", () => {
    const view = projectDemoV3({ ...newDemoV3State(), room: "street" });
    expect(view.characters).toEqual([]);
    expect(view.documentsHere).toEqual([]);
  });
});

it("keeps scan metadata out of the reading scroll while preserving archival provenance", () => {
  const state = { ...newDemoV3State(), held: ["currency"], open: "currency" };
  const doc = projectDemoV3(state).documents[0];
  expect(JSON.stringify(doc)).not.toMatch(/Godot13|scan: 2015/);
  expect(doc.provenance.date).toContain("1942");
});

it("places household records with Gan and later occupation evidence with Elizabeth", () => {
  const docs = (room: string) =>
    projectDemoV3({ ...newDemoV3State(), room }).documentsHere.map((d) => d.id);
  expect(docs("quay")).toEqual(["family", "letter"]);
  expect(docs("household")).toEqual(["life"]);
  expect(docs("records")).toEqual(["choy", "food", "ration", "currency"]);
});
