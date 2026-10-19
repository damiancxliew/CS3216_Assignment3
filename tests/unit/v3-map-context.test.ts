import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EngineSpec } from "@adventure/engine";

import { v3MapContext } from "@/lib/play/v3/map-context";

const spec = EngineSpec.parse(
  JSON.parse(readFileSync(new URL("../../fixtures/golden-1819.json", import.meta.url), "utf8")),
);

describe("v3MapContext", () => {
  it("builds public stage framing and room descriptions without private story content", () => {
    const contexts = v3MapContext(spec);
    const stage = spec.stages[0]!;
    const context = contexts[0]!;
    const json = JSON.stringify(context);

    expect(contexts).toHaveLength(spec.stages.length);
    expect(context).toEqual({
      storyContext: `${spec.title} ${stage.timePlace} ${stage.title}`,
      roomDescriptions: Object.fromEntries(
        stage.rooms.map((room) => [room.id, room.description ?? ""]),
      ),
    });
    expect(Object.keys(context).sort()).toEqual(["roomDescriptions", "storyContext"]);

    for (const discovery of spec.discoveries.filter((item) => item.stageId === stage.id)) {
      if (discovery.text) expect(json).not.toContain(discovery.text);
    }
    const stageCharacterIds = new Set(Object.keys(stage.placement));
    for (const character of spec.characters.filter((item) => stageCharacterIds.has(item.id))) {
      if (character.persona.privateAgenda) expect(json).not.toContain(character.persona.privateAgenda);
    }
    const stageDocumentIds = new Set(Object.keys(stage.documentPlacement));
    for (const document of spec.documents.filter((item) => stageDocumentIds.has(item.id))) {
      if (document.body) expect(json).not.toContain(document.body);
    }
  });
});
