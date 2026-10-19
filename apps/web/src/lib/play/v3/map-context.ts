import type { EngineSpec } from "@adventure/engine";

export type V3StageMapContext = {
  storyContext: string;
  roomDescriptions: Record<string, string>;
};

export function v3MapContext(spec: EngineSpec): V3StageMapContext[] {
  return spec.stages.map((stage) => ({
    storyContext: `${spec.title} ${stage.timePlace} ${stage.title}`,
    roomDescriptions: Object.fromEntries(
      stage.rooms.map((room) => [room.id, room.description ?? ""]),
    ),
  }));
}
