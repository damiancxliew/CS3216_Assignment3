import { afterEach, describe, expect, it, vi } from "vitest";
import { createJobs, defineStep, memoryJobStore } from "@adventure/jobs";

import { handleTick, TICK_SECRET_HEADER, tickUrl } from "@/lib/jobs/tick";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";

const tickSecret = "test-tick-secret";

function enabledEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    V3_ENABLED: "1",
    JOBS_TICK_SECRET: tickSecret,
    ...overrides,
  };
}

function newJobs() {
  return createJobs(memoryJobStore(), [
    defineStep("a", async () => 1),
    defineStep("b", async () => 2),
    defineStep("c", async () => 3),
  ]);
}

describe("jobs tick handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not construct jobs when v3 is disabled", async () => {
    const getJobs = vi.fn(() => newJobs());
    const outcome = await handleTick({
      getJobs,
      secretHeader: tickSecret,
      env: enabledEnv({ V3_ENABLED: "0" }),
    });

    expect(outcome).toEqual({ status: 404, body: { error: "not_found" }, kicks: 0 });
    expect(getJobs).not.toHaveBeenCalled();
  });

  it("does not construct jobs when the tick secret is not configured", async () => {
    const getJobs = vi.fn(() => newJobs());
    const outcome = await handleTick({
      getJobs,
      secretHeader: tickSecret,
      env: { V3_ENABLED: "1" },
    });

    expect(outcome).toEqual({ status: 503, body: { error: "not_configured" }, kicks: 0 });
    expect(getJobs).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong", "wrong-secret"],
    ["missing", null],
  ] as const)("rejects a %s secret header", async (_case, secretHeader) => {
    const getJobs = vi.fn(() => newJobs());
    const outcome = await handleTick({
      getJobs,
      secretHeader,
      env: enabledEnv(),
    });

    expect(outcome).toEqual({ status: 401, body: { error: "unauthorized" }, kicks: 0 });
    expect(getJobs).not.toHaveBeenCalled();
  });

  it("returns no work for an empty queue", async () => {
    const jobs = newJobs();
    const outcome = await handleTick({
      getJobs: () => jobs,
      secretHeader: tickSecret,
      env: enabledEnv(),
    });

    expect(outcome).toEqual({ status: 200, body: { ran: false }, kicks: 0 });
  });

  it("reports a failed claim as a clean 500 with no kicks, leaving recovery to the next tick", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await handleTick({
      getJobs: () => ({ runNext: async () => { throw new Error("connection reset"); } }),
      secretHeader: tickSecret,
      env: enabledEnv(),
    });

    expect(outcome).toEqual({ status: 500, body: { error: "tick_failed" }, kicks: 0 });
  });

  it("runs one step per tick and fans out once for each newly ready dependant", async () => {
    const jobs = newJobs();
    await jobs.enqueue("tick-job", ["a", "b", "c"], { b: ["a"], c: ["a"] });

    const first = await handleTick({
      getJobs: () => jobs,
      secretHeader: tickSecret,
      env: enabledEnv(),
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ran: true, result: { name: "a", status: "succeeded" } });
    expect(first.kicks).toBe(2);

    const nextResults = [
      await handleTick({ getJobs: () => jobs, secretHeader: tickSecret, env: enabledEnv() }),
      await handleTick({ getJobs: () => jobs, secretHeader: tickSecret, env: enabledEnv() }),
    ];
    expect(nextResults.map(({ body }) => body)).toEqual([
      expect.objectContaining({ ran: true, result: expect.objectContaining({ name: "b", status: "succeeded" }) }),
      expect.objectContaining({ ran: true, result: expect.objectContaining({ name: "c", status: "succeeded" }) }),
    ]);
    expect(nextResults.every(({ kicks }) => kicks === 1)).toBe(true);

    const empty = await handleTick({
      getJobs: () => jobs,
      secretHeader: tickSecret,
      env: enabledEnv(),
    });
    expect(empty).toEqual({ status: 200, body: { ran: false }, kicks: 0 });
  });

  it("kicks once after a final step failure", async () => {
    const jobs = createJobs(memoryJobStore(), [
      defineStep("throws", async () => {
        throw new Error("step failed");
      }, { maxAttempts: 1 }),
    ]);
    await jobs.enqueue("failed-job", ["throws"]);

    const outcome = await handleTick({
      getJobs: () => jobs,
      secretHeader: tickSecret,
      env: enabledEnv(),
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      ran: true,
      result: { name: "throws", status: "failed", error: "step failed" },
    });
    expect(outcome.kicks).toBe(1);
  });

  it("uses the configured tick URL or derives it from the request origin", () => {
    expect(tickUrl("https://adventure.example/somewhere", {}))
      .toBe("https://adventure.example/api/v3/jobs/tick");
    expect(tickUrl("https://adventure.example/somewhere", {
      JOBS_TICK_URL: "https://internal.example/tick",
    })).toBe("https://internal.example/tick");
    expect(TICK_SECRET_HEADER).toBe("x-jobs-tick-secret");
  });
});

describe("v3 school flags", () => {
  it("enables only for the exact supported values", () => {
    expect(v3Enabled({ V3_ENABLED: "1" })).toBe(true);
    expect(v3Enabled({ V3_ENABLED: "true" })).toBe(true);
    expect(v3Enabled({ V3_ENABLED: "TRUE" })).toBe(false);
    expect(v3Enabled({ V3_ENABLED: "yes" })).toBe(false);
  });

  it("checks a trimmed allowlist only when v3 is enabled", () => {
    expect(v3SchoolAllowed("school-1", { V3_ENABLED: "1" })).toBe(false);
    expect(v3SchoolAllowed("school-1", { V3_ENABLED: "1", V3_SCHOOL_IDS: "" })).toBe(false);
    expect(v3SchoolAllowed("school-1", { V3_ENABLED: "1", V3_SCHOOL_IDS: " , \t, " })).toBe(false);
    expect(v3SchoolAllowed("school-1", {
      V3_ENABLED: "true",
      V3_SCHOOL_IDS: " school-0, school-1 ,school-2 ",
    })).toBe(true);
    expect(v3SchoolAllowed("school-1", {
      V3_ENABLED: "0",
      V3_SCHOOL_IDS: "school-1",
    })).toBe(false);
  });
});
