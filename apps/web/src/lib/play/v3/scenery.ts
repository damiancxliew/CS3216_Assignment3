import { spritePresentationUrl } from "./sprite-url";
import { publicMediaSnapshot, resolveWalkingSprites, type ResolvedWalkingSprite } from "@/lib/v3/media/resolvers";
import { MATERIAL_NAMES, storyArt, type EnvironmentPlan, type StoryStyle } from "@adventure/game-client/story-art";
import type { CompiledStage } from "@adventure/game-core";
import type { EngineSpec } from "@adventure/engine";
import { landmarkKindFor, roomInterior, type StageMap } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";

/** A deliberately small public projection. Never serialize the spec into the browser. */
export type V3StageScenery = {
  walkingSprites?: Record<string, ResolvedWalkingSprite>;
  roomDescriptions: Record<string, string>;
  storyContext: string;
  /** Curated standalone scenes can supply public geometry to the same map engine. */
  authored?: Pick<CompiledStage, "map" | "playerSpawn" | "initialDoors"> & {
    environment: EnvironmentPlan;
    style: StoryStyle;
    fixtures: NonNullable<PlaygroundSnapshot["landmarks"]>;
    roomKinds: Record<string, string>;
    /** Connected scenes can place arrivals at their doorway instead of the room centre. */
    spawnAtEntrance?: boolean;
    interactionLabels?: "hover";
    desktopCamera?: "detail" | "overview" | "cover";
    playerSheet?: string;
    characterSheets?: Record<string, string>;
    /** Authored figures remain visible outside the current interaction area. */
    cast?: { id: string; name: string; roomId: string }[];
    streetTalk?: PlaygroundSnapshot["streetTalk"];
  };
};

export function v3AdventureScenery(spec: Pick<EngineSpec, "stages"> & Partial<Pick<EngineSpec, "characters" | "authoring">>): V3StageScenery[] {
  return spec.stages.map((stage) => ({
    ...(spec.characters ? { walkingSprites: Object.fromEntries(Object.entries(resolveWalkingSprites({ characters: spec.characters, authoring: spec.authoring })).map(([key, sprite]) => [key, sprite.metadata ? { ...sprite, spriteSheetUrl: spritePresentationUrl(sprite.spriteSheetUrl), metadata: publicMediaSnapshot(sprite.metadata) } : sprite])) } : {}),
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
  if (scenery?.authored) return scenery.authored.fixtures;
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

/** Reuse v2's compiler environment inputs and renderer profiles, inferred locally
 * from v3's public setting. Outdoor props also supply the existing street walkers
 * with stops, instead of leaving them crowded onto the handful of room doors.
 */
export function v3Environment(scenery?: V3StageScenery): EnvironmentPlan | undefined {
  if (scenery?.authored) return scenery.authored.environment;
  if (!scenery) return undefined;
  const rooms = Object.values(scenery.roomDescriptions).join(" ");
  const art = storyArt("auto", "classic", scenery.storyContext, rooms);
  const context = `${scenery.storyContext} ${rooms}`;
  return {
    description: scenery.storyContext,
    ground: MATERIAL_NAMES[art.ground]!, accent: MATERIAL_NAMES[art.secondary]!, path: MATERIAL_NAMES[art.path]!,
    pathStyle: art.id === "civic" || art.id === "palace" ? "formal" : "winding",
    roof: art.id === "civic" ? "terracotta" : art.id === "desert" ? "canvas" : art.id === "jungle" || art.id === "village" ? "thatch" : art.id === "industrial" || art.id === "winter" ? "slate" : "timber",
    waterfront: art.id === "harbor" ? "harbor" : /\briver\b/i.test(context) ? "river" : /\boasis\b/i.test(context) ? "oasis" : "none",
    layout: art.id === "harbor" ? "quayside" : art.id === "civic" || art.id === "palace" ? "garden-loop" : "meandering",
    population: art.id === "harbor" || art.id === "desert" ? "traders" : art.id === "industrial" ? "workers" : ["ruins", "jungle", "battlefield"].includes(art.id) ? "quiet" : "residents",
    vegetation: art.vegetation, propDensity: "lived-in", props: [...art.decorations],
  };
}
