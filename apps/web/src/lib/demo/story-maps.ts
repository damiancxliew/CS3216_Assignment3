import { buildWaterfrontMap } from "./waterfront-map";
import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type MapRoom,
  type StageMap,
} from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

type AuthoredScene = NonNullable<V3StageScenery["authored"]>;
const asset = (name: string) => `/demo/lim-bo-seng/map/${name}.svg`;
export const RESISTANCE_DOORS = [
  { id: "shore", label: "Lim’s coordination shelter", point: { x: 5, y: 7 } },
  { id: "liaison", label: "Tan’s map room", point: { x: 15, y: 7 } },
  { id: "records", label: "Tham’s testimony room", point: { x: 25, y: 7 } },
] as const;

export const STORY_EXIT = { x: 27, y: 18 };
export const storyExitLabels = ["River steps", "Reflection trail"];

/** Authored SVG tiles and collision geometry on the unchanged v3 renderer. */
export function buildStoryMap(
  stage: number,
  stageId: string,
  _roomIds: string[],
  characterIds: string[],
): AuthoredScene {
  if (stage === 0) return buildWaterfrontMap(stageId, characterIds);
  const rooms: MapRoom[] = [
    { id: "coast", x: 0, y: 0, width: 32, height: 19, enclosure: "open" },
  ];
  const map: StageMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: `lim-chapter-v3-${stageId}`,
    stageId,
    seed: `lim-chapter-${stage}`,
    width: 32,
    height: 24,
    tiles: Array.from({ length: 24 }, (_, y) =>
      Array.from({ length: 32 }, (_, x) =>
        y >= 19
          ? "water"
          : y >= 7 &&
              y <= 18 &&
              ((x >= 5 && x <= 8) ||
                (x >= 14 && x <= 16) ||
                (x >= 24 && x <= 27) ||
                (y >= 10 && y <= 12))
            ? "path"
            : "grass",
      ),
    ),
    rooms,
    doors: [],
    doorless: true,
    scenery: [],
    landmarks: [],
    waterBodies: [{ x: -5, y: 19, width: 45, height: 20, kind: "basin" }],
  };
  const fixtures: AuthoredScene["fixtures"] = [];
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
      roomId: "coast",
      kind: "table",
      width: 2,
      height: 2,
      imageUrl: asset(art),
      interactive: Boolean(description),
      description,
    });
    if (solid)
      map.landmarks!.push({
        roomId: "coast",
        kind: "table",
        x,
        y,
        width: 2,
        height: 2,
      });
  }
  const frontages = [
    { name: "fishing", x: 1, y: 1 },
    { name: "stores", x: 11, y: 1 },
    { name: "liaison", x: 21, y: 1 },
  ];
  for (const [i, frontage] of frontages.entries())
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 4; col++)
        fixture(
          `front-${i}-${col}-${row}`,
          frontage.name,
          frontage.x + col * 2,
          frontage.y + row * 2,
          `chapter-${frontage.name}-${col}-${row}`,
        );
  for (const [i, x, y] of [
    [0, 11, 14],
    [1, 17, 14],
  ])
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++)
        fixture(
          `shade-${i}-${col}-${row}`,
          "Tropical shade",
          x + col * 2,
          y + row * 2,
          `canopy-${col}-${row}`,
          true,
        );
  for (const door of RESISTANCE_DOORS)
    fixture(`resistance-door-${door.id}`, door.label, door.point.x, door.point.y,
      "door-mat", false, "Walk inside to meet a historical figure and explore the room.");
  fixture("resistance-alliance", "Cooperation board", 18, 10, "newsstand", true,
    "Explore the groups that cooperated against the occupation.");
  fixture(
    "chapter-exit",
    storyExitLabels[stage],
    28,
    17,
    "exit-jungle",
    false,
    "Complete your three goals, then walk through the marked passage.",
  );
  fixture(
    "chapter-portrait",
    "Photographs of the people you meet",
    3,
    13,
    "writing-desk",
    true,
    "Compare the real photographs with the illustrated people on the map.",
  );
  for (const [i, x] of [3, 21].entries())
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++)
        fixture(
          `boat-${i}-${col}-${row}`,
          "Coastal fishing boat",
          x + col * 2,
          20 + row * 2,
          `river-boat-${col}-${row}`,
          false,
        );
  fixture("net-shore", "Fishing nets", 25, 14, "fishing-net", true);
  fixture("shore-cargo", "Community supplies", 7, 16, "cargo", true);

  // Tropical margins frame a clear, short circulation loop without hiding the cast.
  for (const [x, y] of [
    [0, 8],
    [0, 15],
    [1, 17],
    [31, 12],
  ])
    map.scenery!.push({ kind: "palm", x, y });
  return {
    map,
    playerSpawn: { x: 7, y: 10 },
    initialDoors: {},
    fixtures,
    environment: {
      description: "Perak coast with three enterable timber shelters around a fishing settlement",
      ground: "sand",
      accent: "earth",
      path: "decking",
      roof: "canvas",
      pathStyle: "worn",
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
    spawnAtEntrance: true,
    style: "harbor",
    desktopCamera: "cover",
    interactionLabels: "hover",
    roomKinds: { coast: "camp" },
    playerSheet: asset("civilian"),
    characterSheets: Object.fromEntries(
      characterIds.map((id) => [id, `/demo/lim-bo-seng/sprites/${id}.png`]),
    ),
  };
}
