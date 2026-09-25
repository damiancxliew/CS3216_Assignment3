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

  it("compiles each production stage's authored environment, independently of preview examples", () => {
    const stage = structuredClone(spec.stages[0]!);
    stage.environment = {
      description: "A working river quay", ground: "earth", accent: "gravel", path: "decking",
      pathStyle: "worn", roof: "timber", waterfront: "harbor", layout: "quayside",
      population: "workers", fauna: ["cat"], wind: "breeze", vegetation: .1,
      propDensity: "busy", props: ["crate", "barrel", "rope", "bollard"],
    };
    const quay = compileStageMap(stage, "story-environment");
    expect(toStageLayout(stage).landscape).toEqual({ layout: "quayside", water: "harbor" });
    expect(quay.map.waterBodies?.[0]?.kind).toBe("basin");
    expect(quay.map.scenery?.every(p => stage.environment!.props.includes(p.kind))).toBe(true);
    stage.environment = { ...stage.environment, layout: "meandering", waterfront: "oasis", props: ["palm", "pottery", "sacks"], fauna: ["camel"] };
    const oasis = compileStageMap(stage, "story-environment");
    expect(oasis.map.waterBodies?.[0]?.kind).toBe("oasis");
    expect(oasis.map.tiles).not.toEqual(quay.map.tiles);
    expect(oasis.map.id).not.toBe(quay.map.id);
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
