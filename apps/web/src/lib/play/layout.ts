/**
 * I1 -> I2: a spec stage becomes the compiler's `StageLayoutInput`, and the
 * compiled map becomes the public artifact the client renders.
 *
 * The layout seed is derived from the attempt, never from the resolver's seed:
 * the map is public (the client draws it) and the resolver's rolls are not, so
 * the two must not share a source of randomness (FR-21). `StageMap.seed` is
 * stripped from the projection for the same reason — `seed` is a forbidden
 * response key.
 */
import {
  compileStage,
  landmarkKindFor,
  projectMap,
  validateCompiledStage,
  type CompiledStage,
  type StageLayoutInput,
  type StageMap,
} from "@adventure/game-core";
import type { AdventureSpec, Stage } from "@adventure/generation/spec";
import { createSpatialStageWorld } from "@adventure/game-integration";

export type PublicMap = Omit<StageMap, "seed">;

export class SpatialCompatibilityError extends Error {
  constructor() {
    super("This attempt requires a new compatible adventure version.");
    this.name = "SpatialCompatibilityError";
  }
}

export function readCompiledStages(spec: AdventureSpec, value: unknown): CompiledStage[] {
  try {
    if (!Array.isArray(value) || value.length !== spec.stages.length) throw new SpatialCompatibilityError();
    const stages = value.map((candidate, index) => {
      const validation = validateCompiledStage(candidate);
      if (!validation.valid || (candidate as { map?: { stageId?: string } }).map?.stageId !== spec.stages[index]!.id) throw new SpatialCompatibilityError();
      createSpatialStageWorld(spec, index, candidate as CompiledStage);
      return structuredClone(candidate) as CompiledStage;
    });
    return structuredClone(stages);
  } catch (error) {
    if (error instanceof SpatialCompatibilityError) throw error;
    throw new SpatialCompatibilityError();
  }
}

export function toStageLayout(stage: Stage): StageLayoutInput {
  return {
    stageId: stage.id,
    spawnRoomId: stage.spawnRoomId,
    rooms: stage.rooms.map((room) => {
      if (room.enclosure === null) throw new Error(`Location "${room.id}" requires explicit enclosure; publish a new compatible adventure version.`);
      return { id: room.id, size: room.size, enclosure: room.enclosure, doorDefault: room.doorDefault };
    }),
    landmarks: stage.rooms.flatMap((room) => room.landmark ? [{ roomId: room.id, kind: landmarkKindFor(room.landmark.name, room.landmark.description, room.kind) }] : []),
    placements: [
      ...stage.agents.map((agent) => ({ id: agent.id, kind: "actor" as const, roomId: agent.startRoomId })),
      ...stage.evidence.map((item) => ({ id: item.id, kind: "evidence" as const, roomId: item.roomId })),
      { id: stage.decision.id, kind: "decision" as const, roomId: stage.decision.roomId },
    ],
  };
}

/** Compiler seeds are `[A-Za-z0-9._-]{1,64}`; a uuid plus a stage index fits with room to spare. */
export function layoutSeed(attemptId: string, stageIndex: number): string {
  return `${attemptId.replace(/[^A-Za-z0-9._-]/g, "")}.s${stageIndex}`.slice(0, 64);
}

export function compileStageMap(stage: Stage, attemptId: string): CompiledStage {
  return compileStage(toStageLayout(stage), layoutSeed(attemptId, stage.index));
}

export function publicMap(compiled: CompiledStage): PublicMap {
  const { seed, ...map } = projectMap(compiled);
  void seed;
  return map;
}
