import { describe, expect, it } from "vitest";

import type { JobProgress } from "@adventure/jobs";

import { allowKick, IDLE_MS, KICK_COOLDOWN_MS, shouldKick, STALE_RUNNING_MS } from "@/lib/v3/generation/heal";

const step = (over: Partial<JobProgress["steps"][number]> & { status: JobProgress["steps"][number]["status"] }): JobProgress["steps"][number] => ({
  name: "sources",
  step: "v3.gen.sources",
  attempts: 1,
  error: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString();

describe("shouldKick", () => {
  const NOW = 1_800_000_000_000;

  it("ready step + last activity 11 s ago → true", () => {
    const steps = [
      step({ status: "succeeded", startedAt: iso(20_000, NOW), finishedAt: iso(11_000, NOW) }),
      step({ name: "skeleton", status: "ready" }),
    ];
    expect(shouldKick(steps, NOW)).toBe(true);
  });

  it("ready step + finished 2 s ago → false", () => {
    const steps = [
      step({ status: "succeeded", startedAt: iso(5_000, NOW), finishedAt: iso(2_000, NOW) }),
      step({ name: "skeleton", status: "ready" }),
    ];
    expect(shouldKick(steps, NOW)).toBe(false);
  });

  it("running 5 s ago → false (work in flight)", () => {
    const steps = [step({ status: "running", startedAt: iso(5_000, NOW) }), step({ name: "skeleton", status: "ready" })];
    expect(shouldKick(steps, NOW)).toBe(false);
  });

  it("running 301 s ago → true (dead function)", () => {
    const steps = [step({ status: "running", startedAt: iso(STALE_RUNNING_MS + 1_000, NOW) })];
    expect(shouldKick(steps, NOW)).toBe(true);
  });

  it("all succeeded → false", () => {
    const steps = [step({ status: "succeeded", startedAt: iso(60_000, NOW), finishedAt: iso(30_000, NOW) })];
    expect(shouldKick(steps, NOW)).toBe(false);
  });

  it("standard paused after skeleton (no ready, none running) → false", () => {
    const steps = [
      step({ status: "succeeded", startedAt: iso(120_000, NOW), finishedAt: iso(90_000, NOW) }),
      step({ name: "skeleton", status: "succeeded", startedAt: iso(90_000, NOW), finishedAt: iso(60_000, NOW) }),
    ];
    expect(shouldKick(steps, NOW)).toBe(false);
  });

  it("ready with no timestamps at all → true", () => {
    const steps = [step({ status: "pending" }), step({ name: "skeleton", status: "ready" })];
    expect(shouldKick(steps, NOW)).toBe(true);
  });

  it("ready + last activity just inside the idle window → false", () => {
    const steps = [
      step({ status: "succeeded", finishedAt: iso(IDLE_MS - 1, NOW) }),
      step({ name: "skeleton", status: "ready" }),
    ];
    expect(shouldKick(steps, NOW)).toBe(false);
  });
});

describe("allowKick", () => {
  it("allows the first kick, throttles inside the cooldown, allows again after it", () => {
    const map = new Map<string, number>();
    const id = "adv-1";
    const now = 100_000;
    expect(allowKick(map, id, now)).toBe(true);
    expect(allowKick(map, id, now + KICK_COOLDOWN_MS - 1)).toBe(false);
    expect(allowKick(map, id, now + KICK_COOLDOWN_MS)).toBe(true);
  });

  it("tracks adventures independently", () => {
    const map = new Map<string, number>();
    const now = 100_000;
    expect(allowKick(map, "a", now)).toBe(true);
    expect(allowKick(map, "b", now)).toBe(true);
    expect(allowKick(map, "a", now + 1)).toBe(false);
  });
});
