import { buildWaterfrontMap } from "./waterfront-map";
import {
  GENERATOR_VERSION,
  MAP_SCHEMA_VERSION,
  type MapRoom,
  type StageMap,
} from "@adventure/game-core";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

type AuthoredScene = NonNullable<V3StageScenery["authored"]>;
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
// Compact illustrative geography; never claims to reconstruct a documented camp or address.
const plan = {
  buildings: ["fishing", "stores", "liaison"],
  props: [
    ["fishing-net", 2, 8, 0],
    ["signal-kit", 11, 8, 0],
    ["newsstand", 18, 8, 2],
    ["water-jars", 28, 15, 1],
    ["map-table", 18, 15, 1],
  ],
  description:
    "Perak coast: timber shelters, fishing nets, training records, communication equipment and occupation evidence",
} as const;

export const STORY_EXIT = { x: 27, y: 18 };
export const storyExitLabels = ["River steps", "Reflection trail"];

/** Authored SVG tiles and collision geometry on the unchanged v3 renderer. */
export function buildStoryMap(
  stage: number,
  stageId: string,
  roomIds: string[],
  characterIds: string[],
): AuthoredScene {
  if (stage === 0) return buildWaterfrontMap(stageId, characterIds);
  const rooms: MapRoom[] = [
    { id: roomIds[0], x: 1, y: 7, width: 13, height: 7, enclosure: "open" },
    { id: roomIds[1], x: 17, y: 14, width: 14, height: 5, enclosure: "open" },
    { id: roomIds[2], x: 17, y: 7, width: 14, height: 7, enclosure: "open" },
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
              ((x >= 5 && x <= 9) ||
                (x >= 23 && x <= 28) ||
                (y >= 11 && y <= 14))
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
  const frontages = [
    { name: plan.buildings[0], x: 1, y: 1 },
    { name: plan.buildings[1], x: 11, y: 12 },
    { name: plan.buildings[2], x: 21, y: 1 },
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
          i === 0 ? 0 : 2,
        );
  for (const [i, x, y] of [
    [0, 12, 1],
    [1, 15, 6],
  ])
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++)
        fixture(
          `shade-${i}-${col}-${row}`,
          "Tropical shade",
          x + col * 2,
          y + row * 2,
          `canopy-${col}-${row}`,
          0,
          true,
        );
  const notes: Record<string, string> = {
    ...objectNotes,
    "signal-kit": objectNotes.radio,
    "fishing-net":
      "Fishing equipment belongs to a working community. A landing party depends on people's time and local knowledge. What help can be requested without assuming consent? This net is a representative illustration.",
    "medicine-parcels":
      "Elizabeth Choy and her husband helped prisoners of war with food, medicine, money, letters and radios. These parcels illustrate civilian assistance; they are not evidence of a particular delivery or packaging method.",
    "wash-line":
      "Clothes still need washing while food and time are scarce. Consider who carries the everyday work behind a public story of resistance.",
    newsstand:
      "Examine the occupation press: a real front page, with its date and limits.",
  };
  for (const [art, x, y, room] of plan.props)
    fixture(
      `chapter-${art}`,
      art.replaceAll("-", " "),
      x,
      y,
      art,
      room,
      true,
      notes[art],
    );
  fixture(
    "chapter-exit",
    storyExitLabels[stage],
    28,
    17,
    "exit-jungle",
    1,
    false,
    "Complete your three goals, then walk through the marked passage.",
  );
  fixture(
    "chapter-portrait",
    "Photographs of the people you meet",
    28,
    8,
    "writing-desk",
    2,
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
          0,
          false,
        );
  fixture(
    "net-shore",
    "Fishing nets",
    3,
    16,
    "fishing-net",
    0,
    true,
    notes["fishing-net"],
  );
  fixture(
    "shore-cargo",
    "Community supplies",
    7,
    16,
    "cargo",
    0,
    true,
    notes.cargo,
  );

  // Tropical margins frame a clear, short circulation loop without hiding the cast.
  for (const [x, y] of [
    [0, 8],
    [0, 15],
    [19, 2],
    [31, 12],
  ])
    map.scenery!.push({ kind: "palm", x, y });
  return {
    map,
    playerSpawn: { x: 7, y: 10 },
    initialDoors: {},
    fixtures,
    environment: {
      description: plan.description,
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
    cast: characterIds.map((id, i) => ({
      id,
      name: (
        {
          lim: "Lim Bo Seng",
          gan: "Gan Choo Neo",
          tham: "Tham Sien Yen",
          tan: "Tan Chong Tee",
          elizabeth: "Elizabeth Choy",
        } as Record<string, string>
      )[id],
      roomId: roomIds[i],
    })),
    style: "harbor",
    desktopCamera: "cover",
    roomKinds: Object.fromEntries(roomIds.map((id) => [id, "dock"])),
    playerSheet: asset("civilian"),
    characterSheets: Object.fromEntries(
      characterIds.map((id) => [id, `/demo/lim-bo-seng/sprites/${id}.png`]),
    ),
  };
}
