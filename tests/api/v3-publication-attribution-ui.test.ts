import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PublicationAttribution } from "@/components/teacher/v3-publication-attribution";
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
describe("publication attribution text", () => {
  it("names the publisher with the publication time", () => {
    const html = renderToStaticMarkup(React.createElement(PublicationAttribution, { publication: { publishedBy: "staff", publisherName: "Ms Tan", lastPublishedAt: "2026-10-28T01:00:00.000Z" } }));
    expect(html).toContain("Last published by Ms Tan");
    expect(html).toContain('dateTime="2026-10-28T01:00:00.000Z"');
  });
  it("does not invent an owner or publication date for legacy rows", () => {
    const html = renderToStaticMarkup(React.createElement(PublicationAttribution, { publication: { publishedBy: null, publisherName: null, lastPublishedAt: null } }));
    expect(html).toContain("Publisher not recorded");
    expect(html).not.toContain("<time");
  });
  it("handles an authenticated publisher with no display name", () => {
    const html = renderToStaticMarkup(React.createElement(PublicationAttribution, { publication: { publishedBy: "staff", publisherName: "  ", lastPublishedAt: null } }));
    expect(html).toContain("Last published by an unnamed account");
  });
});
