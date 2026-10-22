import { buildWaterfrontInterior } from "./waterfront-interiors";

/** Reuse collision-safe room geometry, with a distinct collection in each shelter. */
export function buildResistanceInterior(roomId: string) {
  const scene = buildWaterfrontInterior(roomId);
  scene.map.id = `resistance-interior-${roomId}`;
  scene.map.stageId = "network";
  scene.map.seed = `malaya-${roomId}`;
  scene.fixtures = scene.fixtures.filter((f) => !f.interactive || f.id === "room-exit");
  for (const fixture of scene.fixtures) {
    if (fixture.imageUrl?.endsWith("room-tile.svg"))
      fixture.imageUrl = "/demo/lim-bo-seng/map/room-timber.svg";
    if (fixture.id === "room-sign") {
      fixture.imageUrl = `/demo/lim-bo-seng/map/${roomId === "shore" ? "signal-kit" : roomId === "liaison" ? "map-table" : "writing-desk"}.svg`;
      fixture.name = roomId === "shore" ? "Coordination shelter" : roomId === "liaison" ? "Map room" : "Testimony room";
    }
    if (fixture.id === "room-exit") {
      fixture.id = "resistance-room-exit";
      fixture.name = "Return to the coast";
      fixture.description = "Walk through the doorway to return to the coastal settlement.";
    }
  }
  // Removed interactive furnishings must not leave invisible obstacles behind.
  const occupied = new Set(scene.fixtures.map((f) => `${f.position.x},${f.position.y}`));
  scene.map.landmarks = scene.map.landmarks?.filter((p) => occupied.has(`${p.x},${p.y}`));
  const art = roomId === "shore" ? "signal-kit" : roomId === "liaison" ? "map-table" : "bedrolls";
  scene.fixtures.push({
    id: roomId === "shore" ? "resistance-wireless" : roomId === "liaison" ? "resistance-plan" : "training-bedrolls",
    name: roomId === "shore" ? "Wireless operator’s kit" : roomId === "liaison" ? "Tan’s map collection" : "Resting place",
    roomId, position: { x: 4, y: 7 }, kind: "table", width: 2, height: 2,
    imageUrl: `/demo/lim-bo-seng/map/${art}.svg`,
    interactive: roomId !== "records",
    description: roomId === "records" ? undefined : "Explore a museum record and unlock a new hint.",
  });
  scene.map.landmarks!.push({ roomId, kind: "table", x: 4, y: 7, width: 2, height: 2 });
  scene.characterSheets = Object.fromEntries(["lim", "tan", "tham"].map((id) => [id, `/demo/lim-bo-seng/sprites/${id}.png`]));
  scene.environment = { ...scene.environment!, description: "Illustrative Perak timber shelter with evidence, equipment and a historical encounter", ground: "timber", roof: "canvas" };
  return scene;
}
