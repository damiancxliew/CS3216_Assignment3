import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type StageMap,
} from "@adventure/game-core";
import { ARCHIVE_SHELVES } from "./archive-shelves";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

/** Small connected interiors; geography and furnishings are illustrative. */
export function buildWaterfrontInterior(
  roomId: string,
): NonNullable<V3StageScenery["authored"]> {
  const home = roomId === "quay";
  const records = roomId === "records";
  const map: StageMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: `waterfront-interior-${roomId}`,
    stageId: "departure",
    seed: `1942-${roomId}`,
    width: 24,
    height: 16,
    tiles: Array.from({ length: 16 }, () =>
      Array.from({ length: 24 }, () => "path"),
    ),
    rooms: [
      { id: roomId, x: 0, y: 0, width: 24, height: 16, enclosure: "open" },
    ],
    doors: [],
    doorless: true,
    scenery: [],
    landmarks: [],
    waterBodies: [],
  };
  const fixtures: NonNullable<V3StageScenery["authored"]>["fixtures"] = [];
  function prop(
    id: string,
    name: string,
    x: number,
    y: number,
    art: string,
    solid = false,
    description?: string,
  ) {
    fixtures.push({
      id,
      name,
      roomId,
      position: { x, y },
      kind: "table",
      width: 2,
      height: 2,
      imageUrl: `/demo/lim-bo-seng/map/${art}.svg`,
      interactive: Boolean(description),
      description,
    });
    if (solid)
      map.landmarks!.push({ roomId, kind: "table", x, y, width: 2, height: 2 });
  }
  for (let y = 0; y < 16; y += 2)
    for (let x = 0; x < 24; x += 2) {
      const wall = y === 0 || x === 0 || x === 22 || (y === 14 && x !== 12);
      prop(
        `floor-${x}-${y}`,
        "",
        x,
        y,
        wall ? "room-wall" : home ? "room-timber" : "room-tile",
        wall,
      );
    }
  for (const x of [4, 10, 16])
    prop(`window-${x}`, "Louvred window", x, 0, "room-window");
  for (const x of [4, 6, 8, 10, 12, 14, 16, 18])
    prop(
      `shelf-${x}`,
      home ? "Household cupboard" : "Provision shelves",
      x,
      3,
      home ? "room-cabinet" : "room-shelf",
      true,
    );
  prop(
    "room-sign",
    home
      ? "住家 · Household"
      : records
        ? "Later evidence room"
        : "雜貨 · Provision shop",
    11,
    1,
    home ? "home-sign" : records ? "records-sign" : "shop-sign",
  );
  prop(
    "room-exit",
    "Return to River Street",
    12,
    14,
    "door-mat",
    false,
    "Walk through this doorway to return to the street.",
  );
  if (home) {
    prop(
      "waterfront-supplies",
      "Household preparations",
      4,
      7,
      "household-parcels",
      true,
      "Who will obtain supplies, care for the children and keep people informed?",
    );
    prop(
      "water-jars",
      "Household water storage",
      18,
      7,
      "water-jars",
      true,
      "Water is needed for cooking and washing. Who would carry it, store it and keep the household supplied? This arrangement is illustrative, not a record of Gan’s home.",
    );
    prop("bed", "Sleeping mat", 4, 10, "room-bed", true);
    prop(
      "sewing",
      "Clothes and mending",
      18,
      10,
      "room-sewing",
      true,
      "Daily work continues alongside public events. Ask Gan whose responsibilities remain when someone leaves.",
    );
  } else {
    prop("counter", "Shop counter", 18, 7, "room-counter", true);
    if (records) {
      prop("shop-currency", "Ten-cent banknote", 4, 7, "banknote-display", true,
        "A later occupation banknote: examine its issuer and denomination.");
      prop("archive-box", "Archive storage", 18, 10, "room-cabinet", true);
    } else {
      prop("shelter-clipping", "1941 shelter clipping", 4, 7, "newsstand", true,
        "A pre-war newspaper report: where were civilians told to shelter?");
      prop("shop-record", "Rickshaw photograph", 18, 10, "writing-desk", true,
        "Look at the runner and passengers in a period photograph.");
    }
  }
  if (records) {
    for (const shelf of ARCHIVE_SHELVES) {
      const fixture = fixtures.find((f) => f.id === `shelf-${shelf.x}`)!;
      Object.assign(fixture, {
        id: shelf.id, name: shelf.title, interactive: true, pulse: true,
        imageUrl: "/demo/lim-bo-seng/map/archive-folder.svg",
        description: "Walk up to the highlighted folder to read its excerpt.",
      });
    }
  }
  return {
    map,
    fixtures,
    initialDoors: {},
    playerSpawn: { x: 12, y: 12 },
    spawnAtEntrance: true,
    desktopCamera: "cover",
    interactionLabels: "hover",
    style: "harbor",
    roomKinds: { [roomId]: "street" },
    cast: [],
    playerSheet: "/demo/lim-bo-seng/map/civilian.svg",
    characterSheets: Object.fromEntries(
      ["lim", "gan", "elizabeth"].map((id) => [
        id,
        `/demo/lim-bo-seng/sprites/${id}.png`,
      ]),
    ),
    environment: {
      description: home
        ? "Shophouse home with timber floors, louvred windows and domestic provisions"
        : "Singapore provision shop with patterned tiles, timber counters and provision shelves",
      ground: "timber",
      accent: "brick",
      path: "limestone",
      roof: "terracotta",
      pathStyle: "formal",
      waterfront: "none",
      layout: "meandering",
      population: "quiet",
      vegetation: 0,
      propDensity: "sparse",
      props: [],
      wind: "calm",
      fauna: [],
    },
  };
}
