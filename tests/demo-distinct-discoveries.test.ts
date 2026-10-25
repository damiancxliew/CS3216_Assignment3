import { expect, it } from "vitest";
import { findPath, isWalkable } from "@adventure/game-core";
import { demoScenery, newDemoV3State, projectDemoV3, createDemoV3Client } from "../apps/web/src/lib/demo/v3-session";
import { buildResistanceInterior } from "../apps/web/src/lib/demo/resistance-interiors";
import { buildWaterfrontInterior } from "../apps/web/src/lib/demo/waterfront-interiors";
import { RESISTANCE_DOORS } from "../apps/web/src/lib/demo/story-maps";
import { ARCHIVE_SHELVES } from "../apps/web/src/lib/demo/archive-shelves";
import { discoveries, objectDiscoveries } from "../apps/web/src/lib/demo/discoveries";
import { sourceQuestions } from "../apps/web/src/lib/demo/source-questions";
import { stages } from "../apps/web/src/lib/demo/lim-bo-seng";
import { seatIn, v3DocumentProps } from "../apps/web/src/lib/play/v3/map";

it("gives each physical discovery one home across both chapters", () => {
  const scenes = [...demoScenery.map((s) => s.authored), ...["household", "quay", "records"].map(buildWaterfrontInterior), ...RESISTANCE_DOORS.map((d) => buildResistanceInterior(d.id))];
  const items = scenes.flatMap((s) => s.fixtures.filter((f) => f.interactive && !f.id.includes("exit")));
  expect(new Set(items.map((f) => f.id)).size).toBe(items.length);
  expect(items.filter((f) => /newspaper/i.test(f.name))).toHaveLength(1);
  expect(items.filter((f) => /banknote/i.test(f.name))).toHaveLength(1);
  expect(items.every((f) => !/inspect/i.test(f.name))).toBe(true);
  expect(objectDiscoveries["cargo-b"]).toBe("stockpile");
  for (const [id, discovery] of Object.entries(objectDiscoveries)) {
    expect(items.filter((f) => f.id === id)).toHaveLength(1);
    expect(sourceQuestions[`discovery-${discovery}`]).toBeDefined();
    expect(discoveries[discovery].url).toMatch(/^https:\/\//);
  }
  expect(new Set(stages.flatMap((s) => s.sources)).size).toBe(stages.flatMap((s) => s.sources).length);
});

it("puts Elizabeth's excerpts on spaced, glowing shelves that remain readable through the normal source workflow", async () => {
  const scene = buildWaterfrontInterior("records");
  let state = { ...newDemoV3State(), room: "records", intro: false };
  const client = createDemoV3Client(state, (next) => { state = next; });
  expect(projectDemoV3(state).documentsHere).toEqual([]);
  for (const shelf of ARCHIVE_SHELVES) {
    const fixture = scene.fixtures.find((f) => f.id === shelf.id)!;
    expect(fixture.pulse).toBe(true);
    expect(fixture.position).toEqual({ x: shelf.x, y: 3 });
    expect(findPath(scene.map, scene.initialDoors, scene.playerSpawn, shelf.approach)).not.toBeNull();
    expect((await client.act(state.revision, { type: "openDocument", documentId: shelf.sourceId })).ok).toBe(true);
    expect(state.open).toBe(shelf.sourceId);
    expect((await client.act(state.revision, { type: "selectPassage", documentId: shelf.sourceId, start: 0, end: 30 })).ok).toBe(true);
    expect(state.notes.at(-1)?.id).toBe(`source-0-${shelf.sourceId}`);
    await client.act(state.revision, { type: "closeDocument", documentId: shelf.sourceId });
  }
});

it("connects every resistance shelter to the coast, with reachable people, evidence and exits", () => {
  const coast = demoScenery[1].authored;
  const state = newDemoV3State(1);
  expect(state.room).toBe("coast");
  expect(projectDemoV3(state).characters).toEqual([]);
  expect(projectDemoV3(state).documentsHere).toEqual([]);
  for (const door of RESISTANCE_DOORS) {
    expect(findPath(coast.map, coast.initialDoors, coast.playerSpawn, door.point)).not.toBeNull();
    const scene = buildResistanceInterior(door.id);
    const view = projectDemoV3({ ...state, room: door.id });
    expect(view.characters).toHaveLength(1);
    for (const target of [{ x: 12, y: 14 }, seatIn(scene.map, door.id, 1)!, ...v3DocumentProps(scene.map, door.id, view.documentsHere, 2).map((p) => p.position)]) {
      expect(isWalkable(scene.map, scene.initialDoors, target)).toBe(true);
      expect(findPath(scene.map, scene.initialDoors, scene.playerSpawn, target)).not.toBeNull();
    }
  }
});
