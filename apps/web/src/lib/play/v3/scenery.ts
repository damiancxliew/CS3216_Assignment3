import type { EngineSpec } from "@adventure/engine";
import { landmarkKindFor, roomInterior, type StageMap } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";

/** A deliberately small public projection. Never serialize the spec into the browser. */
export type V3StageScenery = {
  roomDescriptions: Record<string, string>;
  storyContext: string;
};

export function v3AdventureScenery(spec: Pick<EngineSpec, "stages">): V3StageScenery[] {
  return spec.stages.map((stage) => ({
    roomDescriptions: Object.fromEntries(stage.rooms.map(({ id, description }) => [id, description])),
    storyContext: `${stage.timePlace} ${stage.title}`,
  }));
}

/** Weather is inferred only from visible setting, never a future opening or an outcome. */
export function v3Atmosphere(context: string): NonNullable<PlaygroundSnapshot["ambient"]> {
  const rules = [
    ["thunderstorm", /\b(thunderstorm|thunder|lightning)\b/i],
    ["snow", /\b(snow|snowy|snowing|blizzard)\b/i],
    ["rain", /\b(rain|raining|rainy|downpour|monsoon)\b/i],
    ["fog", /\b(fog|foggy|mist|misty)\b/i],
    ["dust", /\b(dust|dusty|sandstorm)\b/i],
    ["haze", /\b(haze|hazy|smog)\b/i],
    ["night", /\b(night|midnight|moonlit)\b/i],
    ["clouds", /\b(cloudy|overcast)\b/i],
  ] as const;
  return { id: rules.find(([, pattern]) => pattern.test(context))?.[0] ?? "clear", intensity: 1 };
}

/** Decorative fixtures reuse bundled tiles, without changing collision or evidence. */
export function v3RoomFixtures(map: StageMap, scenery?: V3StageScenery): NonNullable<PlaygroundSnapshot["landmarks"]> {
  return map.rooms.flatMap((room) => {
    const description = scenery?.roomDescriptions[room.id] ?? "";
    if (!description.trim()) return [];
    // Near a wall, away from the centre seats and doorway; the whole 2x2 stamp must fit.
    for (let y = room.y + 2; y < room.y + room.height - 3; y++) {
      for (let x = room.x + 2; x < room.x + room.width - 3; x++) {
        const tiles = [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
        if (!tiles.every((tile) => roomInterior(room, tile))) continue;
        if (tiles.some((tile) => map.doors.some((door) => Math.abs(door.inside.x - tile.x) + Math.abs(door.inside.y - tile.y) < 2))) continue;
        return [{ id: `scenery:${room.id}`, roomId: room.id, name: "Room furnishings", description,
          kind: landmarkKindFor("", description, "office"), position: { x, y }, width: 2 as const, height: 2 as const }];
      }
    }
    return [];
  });
}
