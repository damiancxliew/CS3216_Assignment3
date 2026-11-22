import { GENERATOR_VERSION, MAP_SCHEMA_VERSION, type MapRoom, type StageMap, type Tile } from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

type AuthoredScene = NonNullable<V3StageScenery["authored"]>;

const W = 48;
const H = 27;

/** The same river mouth four years on: shophouses, a market, godowns and a wharf along the same shore. */
export function build1823Map(plate = false): AuthoredScene {
  const tiles: Tile[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => "grass" as Tile));
  const set = (x: number, y: number, t: Tile) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tiles[y]![x] = t;
  };
  const rooms: MapRoom[] = [];
  const doors: StageMap["doors"] = [];
  function building(id: string, x: number, y: number, w: number, h: number, doorX: number) {
    rooms.push({ id, x, y, width: w, height: h, enclosure: "enclosed" });
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        set(xx, yy, yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1 ? "wall" : "floor");
    set(doorX, y + h - 1, "door");
    doors.push({ id: `${id}-door`, roomId: id, position: { x: doorX, y: y + h - 1 }, inside: { x: doorX, y: y + h - 2 }, outside: { x: doorX, y: y + h } });
  }
  const open = (id: string, x: number, y: number, w: number, h: number, tile: Tile = "path") => {
    rooms.push({ id, x, y, width: w, height: h, enclosure: "open" });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, tile);
  };

  // main street and the road down to the wharf
  for (let x = 0; x < 36; x++) for (let y = 7; y <= 8; y++) set(x, y, "path");
  for (let y = 9; y <= 19; y++) for (let x = 17; x <= 18; x++) set(x, y, "path");
  // a row of shophouses along the street
  for (const [i, x] of [1, 8, 15, 22, 29].entries()) building(`shop-${i}`, x, 1, 6, 5, x + 2);
  // market square, godowns on the waterfront, Raffles' house on Government Hill
  open("market", 8, 10, 8, 5);
  open("market-east", 20, 10, 8, 5);
  building("godown-a", 1, 13, 6, 5, 3);
  building("godown-b", 29, 13, 6, 5, 31);
  building("government-house", 38, 3, 8, 6, 41);
  for (let y = 9; y <= 12; y++) set(41, y, "path");
  for (let x = 35; x <= 41; x++) set(x, 12, "path");
  // the wharf runs the length of the shore, with a pier into the sea
  open("wharf", 2, 19, 32, 2, "floor");

  const waterBodies: NonNullable<StageMap["waterBodies"]> = [{ x: -8, y: 21, width: 64, height: 18, kind: "basin" }];
  const inWater = (x: number, y: number) => waterBodies.some(b => {
    const nx = (x + 0.5 - b.x - b.width / 2) / (b.width / 2);
    const ny = (y + 0.5 - b.y - b.height / 2) / (b.height / 2);
    return nx * nx + ny * ny <= 1;
  });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inWater(x, y)) set(x, y, "water");
  for (const px of [17]) {
    rooms.push({ id: `pier-${px}`, x: px, y: 21, width: 2, height: 4, enclosure: "open" });
    for (let y = 21; y <= 24; y++) for (let x = px; x <= px + 1; x++) set(x, y, "floor");
  }

  const scenery: NonNullable<StageMap["scenery"]> = [];
  const prop = (kind: NonNullable<StageMap["scenery"]>[number]["kind"], x: number, y: number) => {
    if (tiles[y]?.[x] === "grass") scenery.push({ kind, x, y });
  };
  for (const [x, y] of [[0, 11], [7, 11], [36, 2], [37, 10], [46, 9], [44, 14], [40, 17], [46, 19], [35, 18], [16, 16], [19, 16]] as const) prop("palm", x, y);
  for (const [x, y] of [[0, 6], [14, 9], [21, 6], [28, 9], [35, 6]] as const) prop("lamp", x, y);
  for (const [x, y] of [[7, 18], [27, 17]] as const) prop("barrel", x, y);
  for (const [x, y] of [[13, 17], [22, 17]] as const) prop("planter", x, y);

  const fixtures: AuthoredScene["fixtures"] = [];
  const landmarks: NonNullable<StageMap["landmarks"]> = [];
  const detail = (id: string, art: string, x: number, y: number, w: number, h: number) => {
    for (let r = 0; r < h / 2; r++)
      for (let c = 0; c < w / 2; c++) {
        const px = x + c * 2, py = y + r * 2;
        fixtures.push({ id: `${id}-${c}-${r}`, name: art, position: { x: px, y: py }, roomId: "market", kind: "table",
          width: 2, height: 2, imageUrl: `/showcase/details/${art}-${c}-${r}.png`, interactive: false });
        landmarks.push({ roomId: "market", kind: "table", x: px, y: py, width: 2, height: 2 });
      }
  };
  for (const [i, [x, y]] of ([[9, 10], [12, 10], [9, 13], [21, 10], [24, 10], [24, 13]] as const).entries()) detail(`stall-${i}`, "stall", x, y, 2, 2);
  detail("cart", "cart", 24, 7, 4, 2);
  for (const [i, [x, y]] of ([[4, 19], [8, 19], [27, 19], [31, 19]] as const).entries()) detail(`cargo-${i}`, i % 2 ? "sacks" : "cargo", x, y, 2, 2);

  return {
    map: {
      schemaVersion: MAP_SCHEMA_VERSION, generatorVersion: GENERATOR_VERSION, id: "why-singapore-1823", stageId: "stage-1",
      seed: "why-singapore-1823", width: W, height: H, tiles, rooms, doors, doorless: true, scenery, landmarks, waterBodies,
    },
    playerSpawn: { x: 46, y: 1 },
    initialDoors: {},
    fixtures,
    environment: {
      description: "Singapore in 1823: a busy free port with shophouses, a market and godowns along the river mouth.",
      ground: "earth", accent: "sand", path: "brick", pathStyle: "formal", roof: "terracotta",
      waterfront: "harbor", layout: "quayside", population: plate ? "quiet" : "traders", wind: "breeze",
      fauna: plate ? [] : ["chicken", "goat"], vegetation: 0.2, propDensity: "busy",
      props: ["palm", "lamp", "barrel", "planter", "crate", "sacks", "awning", "bollard"],
    },
    style: "harbor",
    roomKinds: { market: "market", "market-east": "market", wharf: "dock", "pier-17": "dock" },
    interactionLabels: "hover",
    desktopCamera: "overview",
    spawnAtEntrance: true,
  };
}
