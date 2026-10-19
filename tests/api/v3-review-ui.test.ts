import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  reviewIndex,
  reviewAnchor,
  type ReviewIndexEntry,
} from "@/lib/v3/review";
import { DraftReady } from "@/app/v3/teacher/[id]/draft-ready";
import { AdventureSpec } from "@adventure/spec-v3";
import {
  Citations,
  ReviewScreen,
} from "@/app/v3/teacher/[id]/review/review-screen";

vi.mock("@/components/ui", () => ({
  button: { primary: "primary", subtle: "subtle" },
  compactButton: { primary: "primary", subtle: "subtle" },
}));
const spec = AdventureSpec.parse(
  JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
);

describe("review screen rendering", () => {
  it("shows blocking errors, grouped warnings, conflict fixtures and settings/reveal tabs", () => {
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
    expect(html).toContain("View details");
    expect(html).toContain("Teacher claim");
    expect(html).toContain("Source correction");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Settings");
    expect(html).toContain("Reveal and questions");
    expect(html).toContain(spec.stages[0].openingNarration);
  });

  it("renders every stage outline destination, including rooms, choices and outcomes", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewScreen, {
        spec,
        sources: spec.sources,
        errors: [],
        warnings: [],
      }),
    );
    const walk = (entries: ReviewIndexEntry[]) => {
      for (const entry of entries) {
        expect(html, entry.label).toContain(`id="${reviewAnchor(entry.id)}"`);
        if (entry.children) walk(entry.children);
      }
    };
    walk(reviewIndex(spec, "stages", spec.stages[0].id));
    expect(html).toContain('aria-label="Review details"');
  });

  it("shows draft issues once and makes review and preview available", () => {
    const html = renderToStaticMarkup(
      createElement(DraftReady, {
        adventureId: "draft",
        blocked: true,
        errors: [
          { code: "fixture", path: "", message: "A specific blocking issue" },
        ],
        warnings: [
          {
            code: "fixture-warning",
            path: "",
            message: "A specific warning",
            pass: "details",
          },
        ],
        publishControl: createElement("button", { disabled: true }, "Publish"),
      }),
    );
    expect(html.match(/A specific blocking issue/g)).toHaveLength(1);
    expect(html.match(/A specific warning/g)).toHaveLength(1);
    expect(html).toContain('href="/v3/teacher/draft"');
    expect(html).toContain('href="/v3/teacher/draft/preview"');
    expect(html).not.toContain("Review needed before publishing");
    expect(html).not.toContain("share-title");
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

  it("shows a green success card with optional review notes when checks pass", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewScreen, {
        spec: { ...spec, conflicts: [] },
        sources: [],
        errors: [],
        warnings: [],
      }),
    );
    expect(html).toContain("Checks passed");
    expect(html).not.toContain("Needs fixing (0)");
    expect(html).not.toContain("Conflicts (0)");
    expect(html).toContain("bg-world-wash");
    expect(html).not.toContain("View details");
    expect(html).not.toContain('<details open=""');
  });
});
