import { describe, expect, it } from "vitest";
import { AdventureSpec, Condition, Document } from "@adventure/spec-v3";
import { z } from "zod";
import {
  unwrap,
  template,
  references,
  dependentPaths,
} from "@/lib/v3/edit/form";
import { readFileSync } from "node:fs";
const spec = AdventureSpec.parse(
  JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
);
describe("schema-driven edit forms", () => {
  it("provides structurally valid templates for all entity collections", () => {
    for (const key of [
      "stages",
      "characters",
      "discoveries",
      "documents",
      "triggers",
      "definingMoments",
      "endings",
      "storyEvents",
      "openQuestions",
      "hintAngles",
    ] as const) {
      const schema = (unwrap(AdventureSpec.shape[key]) as z.ZodArray<z.ZodType>)
        .element;
      const result = schema.safeParse(template(schema));
      expect(
        result.success,
        key + ": " + (!result.success ? result.error.message : ""),
      ).toBe(true);
    }
    expect(Condition.safeParse(template(Condition)).success).toBe(true);
    expect(
      Document.shape.keyPassages.element.safeParse(
        template(Document.shape.keyPassages.element),
      ).success,
    ).toBe(true);
  });
  it("uses names for references and finds dependent links before removals", () => {
    expect(references(spec, "characterId")?.[0]).toEqual({
      value: spec.characters[0].id,
      label: spec.characters[0].name,
    });
    expect(dependentPaths(spec, spec.discoveries[0].id).length).toBeGreaterThan(
      0,
    );
  });
});
