import { compileStage, spaceAt, type CompiledStage, type Point, type StageLayoutInput, type StageMap } from "@adventure/game-core";
import type { PlayerView } from "@adventure/play-contract";

import { layoutSeed } from "@/lib/play/layout";

type V3Room = PlayerView["rooms"][number];

const COMPILER_ANCHOR_ID = "v3-map-layout-anchor";

export function v3StageLayout(stageId: string, rooms: readonly V3Room[], spawnRoomId: string): StageLayoutInput {
  return {
    stageId,
    spawnRoomId,
    rooms: rooms.map(({ id }) => ({
      id,
      size: "medium",
      enclosure: "enclosed",
      doorDefault: null,
    })),
    placements: [],
  };
}

export function compileV3StageMap(
  attemptId: string,
  stageId: string,
  stageIndex: number,
  rooms: readonly V3Room[],
  spawnRoomId: string,
): Pick<CompiledStage, "map" | "playerSpawn" | "initialDoors"> {
  const layout = v3StageLayout(stageId, rooms, spawnRoomId);
  const compiled = compileStage({
    ...layout,
    placements: [{ id: COMPILER_ANCHOR_ID, kind: "decision", roomId: spawnRoomId }],
  }, layoutSeed(attemptId, stageIndex), { doors: false });

  return {
    map: compiled.map,
    playerSpawn: compiled.playerSpawn,
    initialDoors: compiled.initialDoors,
  };
}

export function roomIdToEnter(map: StageMap, point: Point, currentRoomId: string | null): string | null {
  const space = spaceAt(map, point);
  return space?.kind === "room" && space.roomId !== currentRoomId ? space.roomId : null;
}
