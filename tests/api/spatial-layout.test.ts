import { loadI1Spec } from "@adventure/generation/fixtures";
import { beforeAll, describe, expect, it } from "vitest";

import { compileStageMap, publicMap, toStageLayout } from "@/lib/play/layout";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => {
  spec = await loadI1Spec();
});

describe("spatial layout artifacts", () => {
  it("preserves authored enclosure and stage identity in every compiled map", () => {
    for (const stage of spec.stages) {
      const compiled = compileStageMap(stage, "spatial-layout-test");
      expect(compiled.map.stageId).toBe(stage.id);
      for (const room of stage.rooms) {
        const mapRoom = compiled.map.rooms.find((candidate) => candidate.id === room.id);
        expect(mapRoom?.enclosure).toBe(room.enclosure);
        const doors = compiled.map.doors.filter((door) => door.roomId === room.id);
        if (room.enclosure === "open") expect(doors).toHaveLength(0);
        else expect(doors).toHaveLength(1);
      }
    }
  });

  it("rejects a room with missing enclosure instead of guessing", () => {
    const cloned = structuredClone(spec);
    cloned.stages[0]!.rooms[0]!.enclosure = null;
    expect(() => toStageLayout(cloned.stages[0]!)).toThrow(/requires explicit enclosure/);
  });

  it("strips private compiler fields from the public map", () => {
    const publicArtifact = publicMap(compileStageMap(spec.stages[0]!, "spatial-layout-test"));
    expect(publicArtifact).not.toHaveProperty("seed");
    expect(publicArtifact).not.toHaveProperty("playerSpawn");
    expect(publicArtifact).not.toHaveProperty("placements");
    expect(publicArtifact).not.toHaveProperty("initialDoors");
  });
});
