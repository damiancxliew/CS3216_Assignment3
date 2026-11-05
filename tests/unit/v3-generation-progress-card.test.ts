import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { GenerationProgress } from "@/lib/v3/generation/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/v3/teacher/actions", () => ({ getV3GenerationProgress: vi.fn() }));

import { GenerationProgress as Poller, GenerationProgressCard } from "@/app/v3/teacher/[id]/generation-progress";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
const startedAt = "2026-10-31T00:00:00.000Z";
function progress(overrides: Partial<GenerationProgress> = {}): GenerationProgress {
  return {
    status: "generating", mode: "quick", costUsd: 1.25, warnings: [],
    steps: [
      { name: "sources", status: "succeeded", attempts: 1, error: null, startedAt, finishedAt: startedAt },
      { name: "skeleton", status: "running", attempts: 1, error: null, startedAt, finishedAt: null },
    ], ...overrides,
  };
}
function render(data: GenerationProgress | null, reconnecting = false, seesCost = false) {
  return renderToStaticMarkup(React.createElement(GenerationProgressCard, {
    progress: data, reconnecting, seesCost, now: Date.parse(startedAt) + 65000,
  }));
}

describe("generation progress bar", () => {
  it("shows completed steps, the visible activity and its elapsed time", () => {
    const html = render(progress());
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain("1/7");
    expect(html).toContain("Overall build: 1 of 7 steps");
    expect(html).toContain("Planning the story · 01:05");
    expect(html).not.toContain("$1.25");
  });
  it("retains the last progress while reconnecting without claiming a running clock", () => {
    const html = render(progress(), true);
    expect(html).toContain("Reconnecting");
    expect(html).toContain('aria-valuenow="1"');
    expect(html).not.toContain("01:05");
  });
  it("names the stopped step and does not count it as complete", () => {
    const failed = render(progress({ status: "failed", steps: [
      progress().steps[0], { ...progress().steps[1], status: "failed" },
    ] }));
    expect(failed).toContain("Stopped at story outline");
    expect(failed).toContain('aria-valuenow="1"');
  });
  it("keeps paused and finished bars text-free apart from the screen-reader status", () => {
    const paused = render(progress({ status: "needs_review", pausedAt: "skeleton", steps: [progress().steps[0], { ...progress().steps[1], status: "succeeded" }] }));
    expect(paused).toContain('<span role="status" class="sr-only">Ready for your review</span>');
    expect(paused).not.toContain("Planning the story");
    const done = render(progress({ status: "draft", steps: [] }));
    expect(done).toContain("Adventure ready");
    expect(done).not.toContain("01:05");
  });
  it("treats a review status without a recorded pause as still working", () => {
    const html = render(progress({ status: "needs_review" }));
    expect(html).toContain("Planning the story");
    expect(html).not.toContain("Ready for your review");
  });
  it("hides clocks without real timestamps and only shows authorized cost", () => {
    const missingTimestamp = progress();
    missingTimestamp.steps[1].startedAt = null;
    expect(render(missingTimestamp)).not.toContain("01:05");
    expect(render(progress(), false, true)).toContain("$1.2500");
  });
  it("never produces a negative elapsed time for a future timestamp", () => {
    const future = progress();
    future.steps[1].startedAt = "2026-10-31T01:00:00.000Z";
    expect(render(future)).toContain("00:00");
  });
  it("starts the poller from the server snapshot instead of an empty bar", () => {
    const html = renderToStaticMarkup(React.createElement(Poller, { adventureId: "a", seesCost: false, initial: progress() }));
    expect(html).toContain("1/7");
    expect(html).not.toContain("0/7");
  });
});
