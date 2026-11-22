import { GENERATOR_VERSION, MAP_SCHEMA_VERSION, type MapRoom, type StageMap, type Tile } from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

type AuthoredScene = NonNullable<V3StageScenery["authored"]>;

export const W = 48;
export const H = 27;

/** Hand-placed 1819 river mouth: village on the left, the river on the right, the sea along the bottom. */
/** `plate` leaves out everything the clip animates on top: boats, people and animals. */
export function build1819Map(plate = false): AuthoredScene {
  const tiles: Tile[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => "grass" as Tile));
  const set = (x: number, y: number, t: Tile) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tiles[y]![x] = t;
  };

  const rooms: MapRoom[] = [];
  const doors: StageMap["doors"] = [];
  function house(id: string, x: number, y: number, w: number, h: number, doorX: number) {
    rooms.push({ id, x, y, width: w, height: h, enclosure: "enclosed" });
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        set(xx, yy, yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1 ? "wall" : "floor");
    set(doorX, y + h - 1, "door");
    doors.push({ id: `${id}-door`, roomId: id, position: { x: doorX, y: y + h - 1 }, inside: { x: doorX, y: y + h - 2 }, outside: { x: doorX, y: y + h } });
  }

  // The open village and the beach are one walkable area.
  // A small earth yard in the middle of the village; everything else is sand and grass.
  rooms.push({ id: "village", x: 9, y: 9, width: 12, height: 6, enclosure: "open" });
  rooms.push({ id: "jetty", x: 17, y: 21, width: 2, height: 5, enclosure: "open" });

  house("house-a", 3, 3, 7, 5, 6);
  house("house-b", 13, 2, 7, 5, 16);
  house("tent", 24, 10, 6, 5, 27);

  // Footpaths: from the houses down to the beach and along to the jetty.
  for (let x = 2; x <= 30; x++) set(x, 12 + (x > 14 && x < 22 ? 1 : 0), "path");
  for (let y = 8; y <= 12; y++) set(6, y, "path");
  for (let y = 7; y <= 12; y++) set(16, y, "path");
  for (let y = 13; y <= 18; y++) set(18, y, "path");
  for (let y = 15; y <= 16; y++) set(27, y, "path");

  // Sea along the bottom, the river from the top right.
  const waterBodies: NonNullable<StageMap["waterBodies"]> = [
    { x: -8, y: 21, width: 64, height: 18, kind: "basin" },
  ];
  const inWater = (x: number, y: number) =>
    waterBodies.some(b => {
      const nx = (x + 0.5 - b.x - b.width / 2) / (b.width / 2);
      const ny = (y + 0.5 - b.y - b.height / 2) / (b.height / 2);
      return nx * nx + ny * ny <= 1;
    });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inWater(x, y)) set(x, y, "water");
  // The jetty runs out over the water.
  for (let y = 21; y <= 25; y++) for (let x = 17; x <= 18; x++) set(x, y, "floor");

  const scenery: NonNullable<StageMap["scenery"]> = [];
  const prop = (kind: NonNullable<StageMap["scenery"]>[number]["kind"], x: number, y: number) => {
    if (tiles[y]?.[x] === "grass") scenery.push({ kind, x, y });
  };
  for (const [x, y] of [[1, 9], [2, 16], [11, 9], [12, 17], [21, 4], [22, 16], [31, 6], [30, 18], [1, 2], [10, 1], [44, 22], [46, 14]] as const) prop("palm", x, y);

  for (const [x, y] of [[3, 9], [10, 8], [21, 9]] as const) prop("pottery", x, y);
  for (const [x, y] of [[23, 16], [24, 17]] as const) prop("sacks", x, y);
  for (const [x, y] of [[15, 18], [20, 18]] as const) prop("crate", x, y);
  for (const [x, y] of [[4, 18], [9, 19]] as const) prop("log", x, y);
  for (const [x, y] of [[34, 4], [38, 8], [41, 3], [36, 15], [42, 12], [40, 18], [33, 10]] as const) prop("palm", x, y);
  for (const [x, y] of [[44, 9], [46, 18]] as const) prop("boulder", x, y);

  // AI-drawn details, stamped as 2x2-tile fixtures (the renderer recolours them to the map palette).
  const fixtures: AuthoredScene["fixtures"] = [];
  const detail = (id: string, art: string, x: number, y: number, w: number, h: number, solid: boolean) => {
    for (let r = 0; r < h / 2; r++)
      for (let c = 0; c < w / 2; c++) {
        const px = x + c * 2, py = y + r * 2;
        fixtures.push({ id: `${id}-${c}-${r}`, name: art, position: { x: px, y: py }, roomId: "village", kind: "table",
          width: 2, height: 2, imageUrl: `/showcase/details/${art}-${c}-${r}.png`, interactive: false });
        if (solid) landmarks.push({ roomId: "village", kind: "table", x: px, y: py, width: 2, height: 2 });
      }
  };
  const landmarks: NonNullable<StageMap["landmarks"]> = [];
  if (!plate) detail("ship", "ship", 30, 22, 6, 4, true);
  if (!plate) detail("sampan-a", "sampan", 19, 22, 4, 2, true);
  if (!plate) detail("sampan-b", "sampan", 11, 23, 4, 2, true);
  detail("canoe", "canoe", 24, 19, 4, 2, true);
  detail("net-a", "netrack", 21, 16, 2, 2, true);
  detail("net-b", "netrack", 7, 16, 2, 2, true);
  detail("fire", "fire", 11, 10, 2, 2, true);
  detail("fish", "fishrack", 2, 13, 2, 2, true);

  const map: StageMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: "why-singapore-1819",
    stageId: "stage-0",
    seed: "why-singapore",
    width: W,
    height: H,
    tiles,
    rooms,
    doors,
    doorless: true,
    scenery,
    landmarks,
    waterBodies,
  };

  return {
    map,
    playerSpawn: { x: 18, y: 13 },
    initialDoors: {},
    fixtures,
    environment: {
      description: "The mouth of the Singapore River, January 1819: a Malay fishing village by the sea.",
      ground: "sand",
      accent: "grass",
      path: "earth",
      pathStyle: "winding",
      roof: "thatch",
      waterfront: "harbor",
      layout: "quayside",
      population: plate ? "quiet" : "residents",
      wind: "breeze",
      fauna: plate ? [] : ["chicken", "cat", "goat"],
      vegetation: 0.35,
      propDensity: "busy",
      props: ["palm", "pottery", "sacks", "crate", "log", "boulder"],
    },
    style: "harbor",
    roomKinds: { village: "camp", jetty: "dock", "house-a": "house", "house-b": "house", tent: "camp" },
    interactionLabels: "hover",
    desktopCamera: "cover",
    spawnAtEntrance: true,
  };
}
