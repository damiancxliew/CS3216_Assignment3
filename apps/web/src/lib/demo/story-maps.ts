import { buildWaterfrontMap } from "./waterfront-map";
import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  waterContains,
  type MapRoom,
  type StageMap,
  type SceneryKind,
} from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import type { EnvironmentPlan } from "@adventure/game-client/story-art";

type AuthoredScene = NonNullable<V3StageScenery["authored"]>;
type Rect = [number, number, number, number];
const objectNotes: Record<string, string> = {
  "rice-counter":
    "Provisions and responsibility\n\nBefore leaving Singapore in February 1942, your obligations to family did not simply disappear. This counter represents the everyday work of keeping a household supplied. Ask Lim and Gan how the sources connect public commitments with family responsibilities.\n\nCompare the family biography and later letter in the Source archive; this is before occupation rationing.",
  "empty-counter":
    "Scarcity changes every decision\n\nThis reconstructed Singapore shop has little stock to spare. Supplying a resistance network can also put pressure on the households supporting it. Ask Elizabeth Choy about civilian assistance and Gan Choo Neo about the limits of household evidence.\n\nThe Singapore rice card, currency and food sources illustrate occupation hardship; they do not prove conditions in any particular household.",
  radio:
    "A network depends on communication\n\nA radio set makes the dependence on training, supplies and trusted information visible. Equipment alone cannot establish that a report is reliable. What would you need to check before passing it on?\n\nSee the Force 136 source. This is a representative wartime set, not an identified model used by Lim.",
  "map-table":
    "A route is also a chain of people\n\nA line on paper leaves out who provides shelter, carries supplies or bears the risk of being discovered. Compare what your contacts can confirm with what you are only assuming. This sketch is invented and is not an operational route.",
  sampan:
    "The shore is someone's livelihood\n\nFishing boats and coastal work are part of the setting around a landing. Local knowledge and cooperation matter, but they cannot be taken for granted.\n\nThese boats evoke a coastal community. They do not represent the submarine journey that brought Lim back to Malaya.",
  rickshaw:
    "A street shaped by human labour\n\nHand-pulled transport, bicycles and cargo carts make this a working neighbourhood. Leaving or moving supplies depends on other people's time and labour. The street and vehicle are illustrative, not a documented stop on Lim's journey.",
  "writing-desk":
    "A record has a point of view\n\nLetters, accounts and later recollections preserve different kinds of evidence. Who made the record? When? What could they know? Collect a nearby source and compare its account with another before deciding.",
  cargo:
    "Supplies are finite\n\nA crate means weight to move, time to spend and someone responsible for its contents. A plan that sounds courageous may still depend on practical preparation. Ask your contact which commitment can actually be kept.",
  "water-jars":
    "The household behind the mission\n\nCooking, washing and storing water continue while the larger conflict unfolds. Consider how the needs of the household constrain the promises a network can make. These containers are representative scene dressing.",
  vegetables:
    "Resilience takes work\n\nA small plot makes visible the work of finding alternative food. The Singapore wartime food source describes adaptation to shortages; use it to ask questions about resilience, without assuming all places or households had the same experience.",
  bedrolls:
    "People need more than orders\n\nRest, food and shelter are part of any sustainable plan. Look beyond whether a task can be completed once: what would continuing it demand from the people involved?",
};
const asset = (name: string) => `/demo/lim-bo-seng/map/${name}.svg`;
// Deliberate stage geography, not reconstructions of a documented address or camp.
const plans: {
  rooms: Rect[];
  facades: [string, number, number][];
  kinds: string[];
  props: [string, number, number, number][];
}[] = [
  {
    rooms: [
      [2, 7, 12, 9],
      [24, 21, 12, 8],
      [24, 7, 12, 9],
    ],
    kinds: ["market", "dock", "street"],
    facades: [
      ["shop", 2, 2],
      ["office", 24, 2],
      ["shop", 2, 21],
    ],
    props: [
      ["rice-counter", 3, 9, 0],
      ["writing-desk", 11, 9, 0],
      ["water-jars", 3, 13, 0],
      ["rickshaw", 16, 14, 0],
      ["cargo", 3, 26, 0],
      ["water-jars", 11, 26, 0],
      ["cargo", 24, 23, 1],
      ["cargo", 33, 23, 1],
      ["sampan", 29, 30, 1],
      ["sampan", 35, 31, 1],
      ["writing-desk", 25, 9, 2],
      ["map-table", 33, 9, 2],
    ],
  },
  {
    rooms: [
      [3, 7, 12, 9],
      [24, 19, 12, 9],
      [24, 6, 12, 9],
    ],
    kinds: ["camp", "camp", "camp"],
    facades: [
      ["camp", 3, 2],
      ["camp", 24, 1],
      ["camp", 24, 15],
    ],
    props: [
      ["radio", 4, 9, 0],
      ["map-table", 12, 9, 0],
      ["cargo", 3, 13, 0],
      ["bedrolls", 25, 21, 1],
      ["water-jars", 33, 21, 1],
      ["writing-desk", 25, 8, 2],
      ["cargo", 33, 8, 2],
    ],
  },
  {
    rooms: [
      [3, 20, 12, 9],
      [24, 8, 12, 9],
      [3, 7, 12, 9],
    ],
    kinds: ["dock", "camp", "camp"],
    facades: [
      ["hut", 24, 3],
      ["hut", 3, 2],
    ],
    props: [
      ["sampan", 5, 30, 0],
      ["sampan", 13, 31, 0],
      ["cargo", 3, 22, 0],
      ["water-jars", 12, 22, 0],
      ["map-table", 25, 10, 1],
      ["bedrolls", 33, 10, 1],
      ["cargo", 4, 9, 2],
      ["cargo", 12, 9, 2],
    ],
  },
  {
    rooms: [
      [2, 7, 12, 9],
      [24, 21, 12, 9],
      [24, 7, 12, 9],
    ],
    kinds: ["market", "field", "street"],
    facades: [
      ["scarce-shop", 2, 2],
      ["office", 24, 2],
      ["scarce-shop", 2, 21],
    ],
    props: [
      ["empty-counter", 3, 9, 0],
      ["water-jars", 11, 9, 0],
      ["rickshaw", 16, 14, 0],
      ["vegetables", 24, 23, 1],
      ["vegetables", 33, 23, 1],
      ["water-jars", 33, 27, 1],
      ["writing-desk", 25, 9, 2],
      ["empty-counter", 33, 9, 2],
    ],
  },
  {
    rooms: [
      [3, 7, 12, 9],
      [25, 21, 12, 9],
      [24, 6, 12, 9],
    ],
    kinds: ["camp", "camp", "camp"],
    facades: [
      ["hut", 3, 2],
      ["camp", 25, 17],
      ["hut", 24, 1],
    ],
    props: [
      ["radio", 4, 9, 0],
      ["map-table", 12, 9, 0],
      ["bedrolls", 26, 23, 1],
      ["cargo", 34, 23, 1],
      ["writing-desk", 25, 8, 2],
      ["map-table", 33, 8, 2],
      ["water-jars", 4, 13, 0],
    ],
  },
];

/** Public geometry and SVG tiles consumed by the existing Phaser renderer/pathfinder. */
export function buildStoryMap(
  stage: number,
  stageId: string,
  roomIds: string[],
  characterIds: string[],
): AuthoredScene {
  if (stage === 0) return buildWaterfrontMap(stageId, roomIds, characterIds);
  const plan = plans[stage];
  const town = stage === 0 || stage === 3;
  const coast = stage === 0 || stage === 2;
  const rooms: MapRoom[] = plan.rooms.map(([x, y, width, height], i) => ({
    id: roomIds[i],
    x,
    y,
    width,
    height,
    enclosure: "open",
  }));
  const map: StageMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: `lim-story-map-v2-${stageId}`,
    stageId,
    seed: `lim-story-${stage}`,
    width: 42,
    height: 36,
    tiles: Array.from({ length: 36 }, () =>
      Array.from({ length: 42 }, () => "grass"),
    ),
    rooms,
    doors: [],
    doorless: true,
    scenery: [],
    landmarks: [],
    waterBodies: coast
      ? [{ x: -8, y: 29, width: 60, height: 20, kind: "basin" }]
      : stage === 4
        ? [{ x: 2, y: 28, width: 11, height: 6, kind: "pond" }]
        : [],
  };
  // A broad waterfront at the bottom; all interactions stay on dry land.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (map.waterBodies?.some((body) => waterContains(body, { x, y })))
        map.tiles[y][x] = "water";
    }
  function pave(x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        if (map.tiles[yy]?.[xx] === "grass") map.tiles[yy][xx] = "path";
  }
  // Linked five-foot ways / camp tracks form an explorable loop, with a central lane.
  pave(2, 6, 36, 2);
  pave(2, 16, 36, 3);
  pave(18, 6, 3, 24);
  pave(2, 28, 36, 1);
  rooms.forEach((r) => {
    pave(r.x + 5, r.y + r.height, 2, 4);
  });
  const fixtures: AuthoredScene["fixtures"] = [];
  function fixture(
    name: string,
    x: number,
    y: number,
    room: number,
    image: string,
    solid = true,
  ) {
    fixtures.push({
      description: objectNotes[image],
      interactive: Boolean(objectNotes[image]),
      id: `${stageId}-${name}-${x}-${y}`,
      name,
      roomId: roomIds[room],
      kind: "table",
      position: { x, y },
      width: 2,
      height: 2,
      imageUrl: asset(image),
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
  plan.facades.forEach(([name, x, y], i) => {
    // Six strips by two rows create one continuous, native-pixel building frontage.
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 6; col++)
        fixture(
          "Period frontage",
          x + col * 2,
          y + row * 2,
          i === 0 ? 0 : i === 1 ? 2 : 1,
          `${name}-${col}-${row}`,
        );
  });
  if (!town) {
    const trees =
      stage === 2
        ? [
            [17, 1],
            [37, 2],
            [17, 10],
            [37, 18],
          ]
        : [
            [17, 0],
            [38, 1],
            [1, 19],
            [8, 24],
            [14, 27],
            [38, 16],
            [38, 28],
          ];
    for (const [x, y] of trees)
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < 2; col++)
          fixture(
            "Tropical canopy",
            x + col * 2,
            y + row * 2,
            0,
            `canopy-${col}-${row}`,
          );
  }
  plan.props.forEach(([name, x, y, room]) =>
    fixture(
      name.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase()),
      x,
      y,
      room,
      name,
    ),
  );
  const decorations: [SceneryKind, number, number][] = town
    ? [
        ["bicycle", 15, 10],
        ["cart", 16, 21],
        ["sacks", 22, 11],
        ["laundry", 37, 12],
        ["palm", 39, 7],
        ["palm", 1, 20],
        ["bollard", 22, 28],
        ["bollard", 38, 28],
        ["rope", 37, 25],
        ["barrel", 22, 25],
        ["noticeboard", 16, 7],
      ]
    : [
        ["palm", 1, 4],
        ["palm", 17, 4],
        ["palm", 22, 4],
        ["palm", 39, 5],
        ["fern", 16, 13],
        ["fern", 22, 13],
        ["log", 15, 23],
        ["fern", 17, 26],
        ["palm", 1, 18],
        ["palm", 39, 20],
        ["palm", 2, 32],
        ["fern", 22, 32],
        ["boulder", 16, 30],
        ["palm", 39, 32],
        ["log", 8, 32],
        ["fern", 17, 10],
        ["fern", 38, 14],
      ];
  for (const [kind, x, y] of decorations)
    if (map.tiles[y][x] === "grass") map.scenery!.push({ kind, x, y });
  const environment: EnvironmentPlan = {
    description: town
      ? "1940s shophouse neighbourhood; shutters, five-foot ways and clay tiles"
      : coast
        ? "Wooded Perak shore with fishing boats and timber shelters"
        : "South Asian wartime field camp with canvas and timber shelters",
    ground: town ? "gravel" : coast ? "sand" : "leaves",
    accent: town ? "brick" : "earth",
    path: town ? "limestone" : coast ? "decking" : "earth",
    roof: town ? "terracotta" : "canvas",
    pathStyle: town ? "formal" : "worn",
    waterfront: coast ? "harbor" : "none",
    layout: coast ? "quayside" : "meandering",
    population: "quiet",
    vegetation: town ? 0.03 : 0.5,
    propDensity: "sparse",
    // Every major prop is authored above. Avoid random generic street furniture.
    props: [],
    wind: "breeze",
    fauna: town ? ["cat"] : [],
  };
  const first = rooms[0];
  return {
    map,
    playerSpawn: { x: first.x + 6, y: first.y + 4 },
    initialDoors: {},
    fixtures,
    environment,
    style: town ? "civic" : coast ? "harbor" : "jungle",
    roomKinds: Object.fromEntries(roomIds.map((id, i) => [id, plan.kinds[i]])),
    playerSheet: asset(stage === 0 ? "civilian" : "field"),
    characterSheets: Object.fromEntries(
      characterIds.map((id) => [id, `/demo/lim-bo-seng/sprites/${id}.png`]),
    ),
  };
}
