import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type StageMap,
} from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

export const WATERFRONT_DOORS = [
  { id: "household", label: "雜貨 · Provision shop", point: { x: 4, y: 7 } },
  { id: "quay", label: "住家 · Home", point: { x: 10, y: 7 } },
  {
    id: "records",
    label: "Later evidence room · 1942–43",
    point: { x: 16, y: 7 },
  },
];
export const BOARDING_POINT = { x: 27, y: 18 };
export function buildWaterfrontMap(
  stageId: string,
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
      { id: "street", x: 0, y: 6, width: 32, height: 13, enclosure: "open" },
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
    solid = true,
    description?: string,
  ) {
    fixtures.push({
      id,
      name,
      position: { x, y },
      roomId: "street",
      kind: "table",
      width: 2,
      height: 2,
      imageUrl: asset(art),
      interactive: Boolean(description),
      description,
    });
    if (solid)
      map.landmarks!.push({
        roomId: "street",
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
        );
  fixture(
    "waterfront-news",
    "Read the dated record",
    21,
    8,
    "newsstand",
    true,
    "Check the date before using a record to explain this departure.",
  );
  fixture(
    "waterfront-newspaper",
    "Occupation newspaper",
    27,
    8,
    "newsstand",
    true,
    "Examine a newspaper from after the surrender: The Shonan Times, 20 February 1942.",
  );
  fixture(
    "waterfront-exit",
    "Board at the river steps",
    28,
    17,
    "boarding-sign",
    false,
    "Finish your recommendation, then walk to the river steps.",
  );
  fixture(
    "rickshaw",
    "Hand-pulled rickshaw",
    12,
    13,
    "rickshaw",
    true,
    "Moving people and goods depended on human labour. The vehicle is illustrative; this is not a documented stop on Lim’s journey.",
  );
  for (const [i, x] of [2, 6, 10, 16, 20, 24, 30].entries())
    fixture(`mooring-${i}`, "Mooring post", x, 17, "mooring", false);
  fixture(
    "cargo-a",
    "Godown cargo",
    29,
    13,
    "cargo",
    true,
    "Goods arriving on the river moved between boats and godowns. This working waterfront is based on Singapore River heritage references, not an exact 1942 address.",
  );
  fixture(
    "cargo-b",
    "Rice sacks",
    18,
    13,
    "rice-counter",
    true,
    "A sack on the quay is also food for a household. Inspect the family biography before assuming who received it.",
  );
  fixture("steps", "River steps", 26, 18, "quay-step", false);
  for (const [b, x] of [3, 23].entries())
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++)
        fixture(
          `boat-${b}-${col}-${row}`,
          "River cargo boat",
          x + col * 2,
          20 + row * 2,
          `river-boat-${col}-${row}`,
          false,
        );
  for (const door of WATERFRONT_DOORS)
    fixture(
      `door-${door.id}`,
      door.label,
      door.point.x,
      door.point.y,
      "door-mat",
      false,
      "Walk onto the doorway to enter. Walk back out to return to this street.",
    );
  for (let x = 0; x < 32; x += 2)
    fixture(`road-${x}`, "River street", x, 11, "street-road", false);
  return {
    map,
    playerSpawn: { x: 4, y: 10 },
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
    cast: [],
    style: "harbor",
    roomKinds: { street: "street" },
    spawnAtEntrance: true,
    desktopCamera: "cover",
    interactionLabels: "hover",
    playerSheet: asset("civilian"),
    characterSheets: Object.fromEntries(
      characterIds.map((id) => [id, `/demo/lim-bo-seng/sprites/${id}.png`]),
    ),
  };
}
