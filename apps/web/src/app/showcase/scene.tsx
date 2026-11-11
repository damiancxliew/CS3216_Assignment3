"use client";

import { compileStage, type StageLayoutInput } from "@adventure/game-core";
import type { EnvironmentPlan } from "@adventure/game-client/story-art";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { V3Map } from "@/components/play/v3/v3-map";
import { v3RoomFixtures, type V3StageScenery } from "@/lib/play/v3/scenery";
import { build1819Map } from "./map-1819";
import { build1823Map } from "./map-1823";

const noop = () => {};
const stayPut = async () => false;

const rooms = [
  { id: "village", name: "Fishing village" },
  { id: "jetty", name: "The jetty" },
  { id: "tent", name: "Raffles' tent" },
  { id: "hut", name: "Trading hut" },
  { id: "house-a", name: "Penghulu's house" },
  { id: "house-b", name: "Fisherman's house" },
];

const environment: EnvironmentPlan = {
  description: "The mouth of the Singapore River, January 1819: a Malay fishing village by the sea.",
  ground: "sand",
  accent: "grass",
  path: "earth",
  pathStyle: "winding",
  roof: "thatch",
  waterfront: "harbor",
  layout: "quayside",
  population: "residents",
  wind: "breeze",
  fauna: ["chicken", "cat", "goat"],
  vegetation: 0.45,
  propDensity: "busy",
  props: ["palm", "fishing-net", "pottery", "sacks", "crate", "barrel", "rope", "fern", "log", "boulder"],
};

const baseLayout: StageLayoutInput = {
  landscape: { layout: environment.layout ?? "quayside", water: environment.waterfront },
  scenery: { palette: environment.props, density: environment.propDensity },
  stageId: "stage-0",
  spawnRoomId: "village",
  rooms: [
    { id: "village", size: "large", enclosure: "open", doorDefault: null },
    { id: "jetty", size: "medium", enclosure: "open", doorDefault: null },
    { id: "tent", size: "small", enclosure: "enclosed", doorDefault: null },
    { id: "hut", size: "small", enclosure: "enclosed", doorDefault: null },
  ],
  placements: [{ id: "showcase-anchor", kind: "decision", roomId: "village" }],
};

const roomDescriptions = {
  village: "A Malay fishing village of attap houses on stilts by the river, with nets drying.",
  jetty: "A wooden jetty on the harbour where sampans tie up; a tall ship is anchored offshore.",
  tent: "A canvas tent on the beach with a table, a sea chart and a telescope.",
  hut: "A small trading hut by the river with sacks, jars and crates.",
};

/** Scripted map for presentation clips: the real v3 renderer with a hand-picked 1819 setting. */
export function ShowcaseScene() {
  const params = useSearchParams();
  const seed = params.get("seed") ?? "why-singapore";
  const camera = (params.get("camera") ?? "overview") as "detail" | "overview" | "cover";
  const shape = params.get("layout") as NonNullable<EnvironmentPlan["layout"]> | null;
  const water = params.get("water") as EnvironmentPlan["waterfront"] | null;

  const authoredMap = params.get("map") !== "generated";
  const mapName = params.get("map");
  const scenery = useMemo<V3StageScenery>(() => {
    if (authoredMap) {
      const plate = params.get("plate") === "1";
      const scene = params.get("map") === "1823" ? build1823Map(plate) : build1819Map(plate);
      const sx = Number(params.get("x") ?? scene.playerSpawn.x), sy = Number(params.get("y") ?? scene.playerSpawn.y);
      return { storyContext: "Singapore River mouth, January 1819", roomDescriptions, authored: { ...scene, playerSpawn: { x: sx, y: sy }, desktopCamera: camera } };
    }
    const layout: StageLayoutInput = {
      ...baseLayout,
      landscape: { layout: shape ?? baseLayout.landscape!.layout, water: water ?? baseLayout.landscape!.water },
    };
    const compiled = compileStage(layout, seed, { doors: false });
    const base: V3StageScenery = { storyContext: "Singapore River mouth, January 1819", roomDescriptions };
    return {
      ...base,
      authored: {
        map: compiled.map,
        playerSpawn: compiled.playerSpawn,
        initialDoors: compiled.initialDoors,
        environment,
        style: "harbor",
        fixtures: v3RoomFixtures(compiled.map, base),
        roomKinds: { village: "field", jetty: "dock" },
        interactionLabels: "hover",
        desktopCamera: camera,
        spawnAtEntrance: true,
      },
    };
  }, [seed, camera, shape, water, authoredMap, mapName]);

  return (
    <main className="fixed inset-0 bg-[#1f2433]">
      <V3Map
        key={`${seed}:${camera}:${shape}:${water}:${mapName}`}
        attemptId="showcase"
        stageId="stage-0"
        stageIndex={0}
        scenery={scenery}
        rooms={rooms}
        spawnRoomId="village"
        currentRoomId={null}
        characters={[]}
        documents={[]}
        walkTo={null}
        movementLocked={false}
        onWalkDone={noop}
        onEnterRoom={stayPut}
        onSelectCharacter={noop}
        onTalk={noop}
        onNearbyCharacterChange={noop}
        onOpenDocument={noop}
        ambient={{ id: "clear", intensity: 1 }}
        audio={{ muted: true }}
        onReadyChange={noop}
      />
    </main>
  );
}
