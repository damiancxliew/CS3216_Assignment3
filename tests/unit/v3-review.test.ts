import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import {
  documentSegments,
  issueTarget,
  reviewErrors,
  reviewDiscoveryTitle,
  reviewIndex,
  reviewSources,
  reviewTargets,
  safeSourceUrl,
} from "@/lib/v3/review";
import { finalCheckErrors } from "@/lib/v3/generation/check-errors";

const spec = AdventureSpec.parse(
  JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
);

describe("review navigation and evidence", () => {
  it("selects nested items from assembled paths, retaining global issues without links", () => {
    const stage = spec.stages[0];
    expect(
      issueTarget(spec, {
        code: "ref",
        path: "stages.0.rooms.0.name",
        message: "room",
      }),
    ).toMatchObject({ tab: "stages", itemId: stage.id });
    expect(
      issueTarget(spec, {
        code: "x",
        path: "characters.0.persona.voice",
        message: "voice",
      }),
    ).toMatchObject({ tab: "characters", itemId: spec.characters[0].id });
    expect(
      issueTarget(spec, {
        code: "x",
        path: "documents.0.body",
        message: "body",
      }),
    ).toMatchObject({ tab: "documents", itemId: spec.documents[0].id });
    expect(
      issueTarget(spec, {
        code: "x",
        path: "endings.0.interview.question",
        message: "interview",
      }),
    ).toMatchObject({ tab: "endings", itemId: spec.endings[0].id });
    expect(
      issueTarget(spec, { code: "x", path: "", message: "global" }),
    ).toBeUndefined();
  });

  it("uses the part owner rather than treating local indices as assembled indices", () => {
    const stage = spec.stages.at(-1)!;
    const errors = finalCheckErrors({
      partErrors: [
        {
          part: `stage:${stage.id}`,
          issue: {
            code: "quote",
            path: "documents.0.body",
            message: "Bad quote",
          },
        },
      ],
    });
    expect(issueTarget(spec, errors[0])).toMatchObject({
      tab: "stages",
      itemId: stage.id,
    });
    expect(reviewErrors(spec, errors)).toContainEqual(errors[0]);
  });

  it("targets discoveries, slants and conflict fixture item ids", () => {
    const targets = reviewTargets(spec);
    for (const discovery of spec.discoveries)
      expect(targets.get(discovery.id)?.itemId).toBe(discovery.stageId);
    const conflict = {
      id: "fixture-conflict",
      itemIds: [spec.characters[0].id, spec.documents[0].id],
      teacherSays: "Brief claim",
      sourceSays: "Contradicting source",
      sourceId: spec.sources[0].id,
    };
    const fixture = AdventureSpec.parse({ ...spec, conflicts: [conflict] });
    expect(
      fixture.conflicts[0].itemIds.map((id) => targets.get(id)?.tab),
    ).toEqual(["characters", "documents"]);
  });

  it("recovers old source origins and URLs without mutating saved specs", () => {
    const before = JSON.stringify(spec);
    const source = spec.sources[0];
    const sources = reviewSources(spec, [
      {
        id: source.id,
        title: "Recovered outside source",
        origin: "outside",
        url: "https://example.com/source",
        kind: "text",
        contentHash: "hash",
        pages: [],
        pageCount: 0,
        charCount: 0,
        warnings: [],
      },
    ]);
    expect(sources.find((s) => s.id === source.id)).toMatchObject({
      origin: "outside",
      url: "https://example.com/source",
    });
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("preserves all text when highlighted passages overlap, adjoin or exceed bounds", () => {
    const doc = {
      body: "A日B😀CD",
      keyPassages: [
        { id: "a", start: 1, end: 4 },
        { id: "b", start: 3, end: 7 },
        { id: "c", start: 7, end: 100 },
      ],
    };
    const segments = documentSegments(doc);
    expect(segments.map((s) => s.text).join("")).toBe(doc.body);
    expect(segments.find((s) => s.start === 3)?.passageIds).toEqual(["a", "b"]);
    expect(documentSegments({ body: "unmarked", keyPassages: [] })).toEqual([
      { start: 0, text: "unmarked", passageIds: [] },
    ]);
  });

  it("names the character in possessive discovery topics without changing the saved content", () => {
    const discovery = {
      ...spec.discoveries.find((d) => "characterId" in d.holder)!,
      topic: "his fears about Riau",
    };
    const holderId =
      "characterId" in discovery.holder ? discovery.holder.characterId : "";
    const holder = spec.characters.find((c) => c.id === holderId)!;
    const before = JSON.stringify(discovery);
    const title = reviewDiscoveryTitle(spec, discovery);
    expect(title).toBe(
      `${holder.name}${/s$/i.test(holder.name) ? "’" : "’s"} fears about Riau`,
    );
    const fixture = { ...spec, discoveries: [discovery] };
    expect(
      reviewIndex(fixture, "stages", discovery.stageId).find(
        (entry) => entry.label === "Discoveries",
      )?.children?.[0].label,
    ).toBe(title);
    expect(JSON.stringify(discovery)).toBe(before);
    expect(
      reviewDiscoveryTitle(spec, {
        ...discovery,
        holder: { documentId: spec.documents[0].id, keyPassageId: "passage" },
      }),
    ).toBe(discovery.text);
  });

  it("surfaces structural errors and rejects executable source URLs", () => {
    expect(
      reviewErrors({ title: "Broken" }).some((i) => i.code === "schema"),
    ).toBe(true);
    expect(safeSourceUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeSourceUrl("https://example.com/source")).toBe(
      "https://example.com/source",
    );
  });
});
