import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { parseSpecImport, specExport, MAX_SPEC_BYTES } from "@/lib/v3/spec-transfer";

const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));

describe("v3 JSON transfer", () => {
  it("round trips the adventure and captured sources", () => {
    const sources = [{ id: "reading", title: "Reading", kind: "text" as const, pages: [{ page: 1, text: "Original source text." }] }];
    const exported = specExport(spec, sources, "original", 3);
    const imported = parseSpecImport(JSON.stringify(exported));
    expect(imported).toEqual(exported);
    expect(imported.sources).toEqual(sources);
    expect(imported.spec.title).toBe(spec.title);
    expect(imported.spec.characters).toEqual(spec.characters);
    expect(JSON.stringify(exported)).not.toContain("owner_id");
  });

  it("accepts a raw v3 spec for hand editing", () => {
    expect(parseSpecImport(JSON.stringify(spec))).toEqual({ format: "pocket-adventure-v3", version: 1, spec, sources: [] });
  });

  it.each(["{", "null", JSON.stringify({ title: "Incomplete" }), JSON.stringify({ format: "pocket-adventure-v3", version: 99, spec, sources: [] })])("rejects malformed, incompatible, or incomplete JSON: %s", (text) => {
    expect(() => parseSpecImport(text)).toThrow();
  });

  it("rejects duplicate source ids", () => {
    const source = { id: "same", title: "Source", kind: "text", pages: [] };
    expect(() => parseSpecImport(JSON.stringify({ format: "pocket-adventure-v3", version: 1, spec, sources: [source, source] }))).toThrow(/Duplicate source/);
  });

  it("preserves source provenance and image selections", () => {
    const sources = [{ id: "archive", title: "Archive", kind: "text" as const, origin: "outside" as const, url: "https://example.org/archive", pages: [] }];
    const withImage = structuredClone(spec);
    withImage.authoring = { stageImages: { [spec.stages[0].id]: { type: "legacy", url: "https://example.org/stage.webp", version: 3 } } };
    const imported = parseSpecImport(JSON.stringify(specExport(withImage, sources, "old-id", 3)));
    expect(imported.sources).toEqual(sources);
    expect(imported.spec.authoring?.stageImages?.[spec.stages[0].id]).toEqual(withImage.authoring.stageImages![spec.stages[0].id]);
  });

  it("rejects oversized input before parsing", () => {
    expect(() => parseSpecImport(" ".repeat(MAX_SPEC_BYTES + 1))).toThrow(/10 MB/);
  });
});
