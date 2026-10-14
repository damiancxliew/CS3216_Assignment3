import { describe, expect, it } from "vitest";
import { createJobs, defineStep, memoryJobStore } from "../src/index.js";
import { describeJobStore } from "../src/testing.js";

describeJobStore("memory", () => memoryJobStore());

describe("createJobs", () => {
  it("expires leases from the injected clock", async () => {
    let time = Date.now();
    const store = memoryJobStore({ now: () => time });
    const jobId = crypto.randomUUID();
    await store.enqueue(jobId, [
      { name: "expires", step: "expires", input: null, deps: [], maxAttempts: 1 },
    ]);
    const claimed = await store.claim(crypto.randomUUID(), 1, jobId);
    time += 1_001;
    expect(await store.claim(crypto.randomUUID(), 1, jobId)).toBeNull();
    expect((await store.list(jobId))[0]).toMatchObject({
      status: "failed",
      error: "lease expired after final attempt",
    });
    expect(claimed?.attempts).toBe(1);
  });

  it("rejects unknown steps, unknown dependencies, and cycles before enqueue", async () => {
    const store = memoryJobStore();
    const jobs = createJobs(store, [defineStep("known", async () => null)]);
    const jobId = crypto.randomUUID();
    await expect(jobs.enqueue(jobId, ["unknown"])).rejects.toThrow("unknown step definition");
    await expect(jobs.enqueue(jobId, ["known"], { known: ["missing"] })).rejects.toThrow("unknown dependency");
    await expect(
      jobs.enqueue(jobId, ["known", { name: "second", step: "known" }], {
        known: ["second"],
        second: ["known"],
      }),
    ).rejects.toThrow("dependency cycle");
    expect(await store.list(jobId)).toEqual([]);
  });

  it("drains a diamond and passes dependency outputs to each step", async () => {
    const store = memoryJobStore();
    const seen: Record<string, Record<string, unknown>> = {};
    const jobs = createJobs(store, [
      defineStep("sources", async () => ({ source: "sources" })),
      defineStep("stageDetails", async ({ outputs }) => {
        seen.stageDetails = outputs;
        return { detail: outputs.sources ?? null };
      }),
      defineStep("personas", async ({ outputs }) => {
        seen.personas = outputs;
        return { persona: outputs.sources ?? null };
      }),
      defineStep("endings", async ({ outputs }) => {
        seen.endings = outputs;
        return { ending: true };
      }),
    ]);
    const jobId = crypto.randomUUID();
    await jobs.enqueue(
      jobId,
      ["sources", "stageDetails", "personas", "endings"],
      {
        stageDetails: ["sources"],
        personas: ["sources"],
        endings: ["stageDetails", "personas"],
      },
    );
    const progress = await jobs.drain({ jobId });
    expect(progress?.status).toBe("succeeded");
    expect(progress?.done).toBe(4);
    expect(seen.stageDetails).toEqual({ sources: { source: "sources" } });
    expect(seen.personas).toEqual({ sources: { source: "sources" } });
    expect(seen.endings).toEqual({
      stageDetails: { detail: { source: "sources" } },
      personas: { persona: { source: "sources" } },
    });
  });

  it("reports progress counts", async () => {
    const store = memoryJobStore();
    const jobs = createJobs(store, [
      defineStep("first", async () => "done"),
      defineStep("next", async () => "done"),
    ]);
    const jobId = crypto.randomUUID();
    expect(await jobs.getProgress(jobId)).toBeNull();
    await jobs.enqueue(jobId, ["first", "next"], { next: ["first"] });
    expect(await jobs.getProgress(jobId)).toMatchObject({
      status: "running",
      done: 0,
      total: 2,
    });
    await jobs.runNext({ jobId });
    expect(await jobs.getProgress(jobId)).toMatchObject({
      status: "running",
      done: 1,
      total: 2,
    });
  });

  it("fails unknown step names claimed from the store", async () => {
    const store = memoryJobStore();
    const jobId = crypto.randomUUID();
    await store.enqueue(jobId, [
      { name: "later", step: "removed-definition", input: null, deps: [], maxAttempts: 1 },
    ]);
    const jobs = createJobs(store, []);
    expect(await jobs.runNext({ jobId })).toMatchObject({
      status: "failed",
      error: "unknown step definition: removed-definition",
    });
  });
});
