import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type StageMap,
} from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

export const BOARDING_POINT = { x: 27, y: 18 };
export function buildWaterfrontMap(
  stageId: string,
  roomIds: string[],
  characterIds: string[],
): NonNullable<V3StageScenery["authored"]> {
  const map: StageMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: `singapore-waterfront-v1-${stageId}`,
    stageId,
    seed: "singapore-river-1942",
    width: 32,
    height: 24,
    tiles: Array.from({ length: 24 }, (_, y) =>
      Array.from({ length: 32 }, () => (y >= 19 ? "water" : "path")),
    ),
    rooms: [
      { id: roomIds[0], x: 1, y: 7, width: 11, height: 7, enclosure: "open" },
      { id: roomIds[1], x: 18, y: 12, width: 12, height: 7, enclosure: "open" },
      { id: roomIds[2], x: 14, y: 7, width: 16, height: 5, enclosure: "open" },
    ],
    doors: [],
    doorless: true,
    scenery: [],
    landmarks: [],
    waterBodies: [{ x: -5, y: 19, width: 45, height: 20, kind: "basin" }],
  };
  const fixtures: NonNullable<V3StageScenery["authored"]>["fixtures"] = [];
  const asset = (name: string) => `/demo/lim-bo-seng/map/${name}.svg`;
  function fixture(
    id: string,
    name: string,
    x: number,
    y: number,
    art: string,
    room = 0,
    solid = true,
    description?: string,
  ) {
    fixtures.push({
      id,
      name,
      position: { x, y },
      roomId: roomIds[room],
      kind: "table",
      width: 2,
      height: 2,
      imageUrl: asset(art),
      interactive: Boolean(description),
      description,
    });
    if (solid)
      map.landmarks!.push({
        roomId: roomIds[room],
        kind: "table",
        x,
        y,
        width: 2,
        height: 2,
      });
  }
  for (const [i, name] of [
    "provision",
    "home",
    "coffee",
    "merchant",
    "godown",
  ].entries())
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++)
        fixture(
          `front-${i}-${col}-${row}`,
          "Shophouse frontage",
          1 + i * 6 + col * 2,
          1 + row * 2,
          `river-${name}-${col}-${row}`,
          i < 2 ? 0 : 2,
        );
  fixture(
    "waterfront-supplies",
    "Household preparations",
    2,
    8,
    "household-parcels",
    0,
    true,
    "Choose what your support arrangement needs to address.",
  );
  fixture(
    "waterfront-news",
    "Read the dated record",
    15,
    8,
    "newsstand",
    2,
    true,
    "Check the date before using a record to explain this departure.",
  );
  fixture(
    "waterfront-exit",
    "Board at the river steps",
    28,
    17,
    "boarding-sign",
    1,
    false,
    "Finish your recommendation, then walk to the river steps.",
  );
  fixture(
    "water-jars",
    "Household water jars",
    10,
    8,
    "water-jars",
    0,
    true,
    "Cooking, washing and keeping a household supplied still take work. Ask Gan what a public story of resistance leaves out about family responsibilities.",
  );
  fixture(
    "rickshaw",
    "Hand-pulled rickshaw",
    12,
    13,
    "rickshaw",
    0,
    true,
    "Moving people and goods depended on human labour. The vehicle is illustrative; this is not a documented stop on Lim’s journey.",
  );
  for (const [i, x] of [2, 6, 10, 16, 20, 24, 30].entries())
    fixture(`mooring-${i}`, "Mooring post", x, 17, "mooring", 1, false);
  fixture(
    "cargo-a",
    "Godown cargo",
    29,
    13,
    "cargo",
    1,
    true,
    "Goods arriving on the river moved between boats and godowns. This working waterfront is based on Singapore River heritage references, not an exact 1942 address.",
  );
  fixture(
    "cargo-b",
    "Rice sacks",
    18,
    13,
    "rice-counter",
    1,
    true,
    "A sack on the quay is also food for a household. Inspect the family biography before assuming who received it.",
  );
  fixture("steps", "River steps", 26, 18, "quay-step", 1, false);
  for (const [b, x] of [3, 23].entries())
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++)
        fixture(
          `boat-${b}-${col}-${row}`,
          "River cargo boat",
          x + col * 2,
          20 + row * 2,
          `river-boat-${col}-${row}`,
          1,
          false,
        );
  return {
    map,
    playerSpawn: { x: 6, y: 10 },
    initialDoors: {},
    fixtures,
    environment: {
      description:
        "Singapore River shophouses, five-foot ways, godowns and granite quay",
      ground: "gravel",
      accent: "brick",
      path: "limestone",
      roof: "terracotta",
      pathStyle: "formal",
      waterfront: "harbor",
      layout: "quayside",
      population: "quiet",
      vegetation: 0,
      propDensity: "sparse",
      props: [],
      wind: "breeze",
      fauna: [],
    },
    cast: [
      { id: "lim", name: "Lim Bo Seng", roomId: roomIds[0] },
      { id: "gan", name: "Gan Choo Neo", roomId: roomIds[1] },
    ],
    style: "harbor",
    roomKinds: {
      [roomIds[0]]: "street",
      [roomIds[1]]: "dock",
      [roomIds[2]]: "street",
    },
    desktopCamera: "overview",
    playerSheet: asset("civilian"),
    characterSheets: Object.fromEntries(
      characterIds.map((id) => [id, `/demo/lim-bo-seng/sprites/${id}.png`]),
    ),
  };
}
