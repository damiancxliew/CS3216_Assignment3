import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { V3PublishPanel } from "@/components/play/v3/publish-panel";

vi.mock("@/app/v3/teacher/[id]/publish-actions", () => ({
  publishV3Adventure: vi.fn(),
  unpublishV3Adventure: vi.fn(),
}));
vi.mock("@/components/ui", () => ({ button: { subtle: "", quiet: "" } }));
// The root Vitest config uses the classic JSX transform for existing UI modules.
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("publish controls", () => {
  it("disables publishing and exposes the reason accessibly", () => {
    const html = renderToStaticMarkup(
      createElement(V3PublishPanel, {
        adventureId: "draft",
        published: false,
        blockedReason: "Fix the story errors",
      }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-describedby="publish-block-draft"');
    expect(html).toContain("Fix the story errors");
    expect(html).not.toContain("Not published");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('aria-label="Publish unavailable"');
    expect(html).toContain('tabindex="0"');
  });
  it("allows an owner to unpublish even if the draft has blocking errors", () => {
    const html = renderToStaticMarkup(
      createElement(V3PublishPanel, {
        adventureId: "live",
        published: true,
        blockedReason: "Fix errors",
      }),
    );
    expect(html).toContain("Unpublish");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("Fix errors");
  });
});
