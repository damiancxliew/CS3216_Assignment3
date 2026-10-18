import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import {
  Citations,
  ReviewScreen,
} from "@/app/v3/teacher/[id]/review/review-screen";

vi.mock("@/components/ui", () => ({
  button: { primary: "primary", subtle: "subtle" },
}));
const spec = AdventureSpec.parse(
  JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
);

describe("review screen rendering", () => {
  it("shows blocking errors, grouped warnings, conflict fixtures and accessible edit placeholders", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewScreen, {
        spec: {
          ...spec,
          conflicts: [
            {
              id: "conflict",
              itemIds: [spec.characters[0].id],
              teacherSays: "Teacher claim",
              sourceSays: "Source correction",
              sourceId: spec.sources[0].id,
            },
          ],
        },
        sources: spec.sources,
        errors: [
          { code: "global", path: "", message: "Global blocking issue" },
        ],
        warnings: [
          {
            code: "example",
            path: "characters.0.persona.voice",
            message: "Check this voice",
            pass: "details",
          },
        ],
      }),
    );
    expect(html).toContain("Needs fixing (1)");
    expect(html).toContain("Global blocking issue");
    expect(html).toContain("Teacher claim");
    expect(html).toContain("Source correction");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-describedby="edit-coming-soon"');
    expect(html).toContain("Coming soon");
    expect(html).toContain(spec.stages[0].openingNarration);
  });

  it("keeps source labels without citations and distinguishes missing quotes and origins", () => {
    const noCitations = renderToStaticMarkup(
      createElement(Citations, {
        label: "Teacher-written inference",
        sources: [],
      }),
    );
    expect(noCitations).toContain("Teacher-written inference");
    expect(noCitations).toContain("No citations available");
    const html = renderToStaticMarkup(
      createElement(Citations, {
        citations: [
          { sourceId: "outside", quote: "Exact quoted text" },
          { sourceId: "upload" },
          { sourceId: "missing" },
        ],
        sources: [
          {
            id: "outside",
            title: "Outside title",
            origin: "outside",
            url: "https://example.com",
          },
          { id: "upload", title: "Handout", origin: "teacher" },
        ],
      }),
    );
    expect(html).toContain("Outside source");
    expect(html).toContain("Teacher-provided source");
    expect(html).toContain("Source unavailable");
    expect(html).toContain("Exact quoted text");
    expect(html).toContain("No quoted passage available");
  });

  it("describes empty generated conflicts as detection pending", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewScreen, {
        spec: { ...spec, conflicts: [] },
        sources: [],
        errors: [],
        warnings: [],
      }),
    );
    expect(html).toContain("Conflict detection pending");
  });
});
