import { describe, expect, it } from "vitest";
import type { JobStore } from "./index.js";

export function describeJobStore(label: string, makeStore: () => JobStore) {
  describe(`${label} job store contract`, () => {
    it("makes no-dependency steps ready and dependent steps pending", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "first", step: "first", input: null, deps: [], maxAttempts: 3 },
        { name: "next", step: "next", input: null, deps: ["first"], maxAttempts: 3 },
      ]);
      const rows = await store.list(jobId);
      expect(rows.map(({ name, status }) => [name, status])).toEqual([
        ["first", "ready"],
        ["next", "pending"],
      ]);
    });

    it("claims once and allows concurrent workers to claim different steps", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "one", step: "one", input: null, deps: [], maxAttempts: 3 },
        { name: "two", step: "two", input: null, deps: [], maxAttempts: 3 },
      ]);
      const claimed = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(claimed).not.toBeNull();
      expect(await store.claim(crypto.randomUUID(), 330, jobId)).not.toBeNull();
      expect(await store.claim(crypto.randomUUID(), 330, jobId)).toBeNull();

      const concurrentJob = crypto.randomUUID();
      await store.enqueue(concurrentJob, [
        { name: "one", step: "one", input: null, deps: [], maxAttempts: 3 },
        { name: "two", step: "two", input: null, deps: [], maxAttempts: 3 },
      ]);
      const [a, b] = await Promise.all([
        store.claim(crypto.randomUUID(), 330, concurrentJob),
        store.claim(crypto.randomUUID(), 330, concurrentJob),
      ]);
      expect(a?.id).not.toBe(b?.id);
    });

    it("readies dependants only after all dependencies succeed", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "left", step: "left", input: null, deps: [], maxAttempts: 3 },
        { name: "right", step: "right", input: null, deps: [], maxAttempts: 3 },
        { name: "join", step: "join", input: null, deps: ["left", "right"], maxAttempts: 3 },
      ]);
      const left = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(left).not.toBeNull();
      expect((await store.complete(left!.id, left!.leaseToken!, null)).map((row) => row.name)).toEqual([]);
      expect((await store.list(jobId)).find((row) => row.name === "join")?.status).toBe("pending");
      const right = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(right).not.toBeNull();
      expect((await store.complete(right!.id, right!.leaseToken!, null)).map((row) => row.name)).toEqual(["join"]);
    });

    it("fails dependency chains transitively after a final failure", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "a", step: "a", input: null, deps: [], maxAttempts: 1 },
        { name: "b", step: "b", input: null, deps: ["a"], maxAttempts: 3 },
        { name: "c", step: "c", input: null, deps: ["b"], maxAttempts: 3 },
      ]);

      const a = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(a?.name).toBe("a");
      expect((await store.fail(a!.id, a!.leaseToken!, "failed")).status).toBe("failed");

      expect((await store.list(jobId)).map(({ name, status, error }) => [name, status, error])).toEqual([
        ["a", "failed", "failed"],
        ["b", "failed", "dependency failed: a"],
        ["c", "failed", "dependency failed: b"],
      ]);
      expect(await store.claim(crypto.randomUUID(), 330, jobId)).toBeNull();
    });

    it("fails a join without blocking an independent dependency", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "a", step: "a", input: null, deps: [], maxAttempts: 1 },
        { name: "x", step: "x", input: null, deps: [], maxAttempts: 3 },
        { name: "join", step: "join", input: null, deps: ["a", "x"], maxAttempts: 3 },
      ]);

      const a = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(a?.name).toBe("a");
      await store.fail(a!.id, a!.leaseToken!, "failed");

      const rows = await store.list(jobId);
      expect(rows.find((row) => row.name === "join")).toMatchObject({
        status: "failed",
        error: "dependency failed: a",
      });
      expect(rows.find((row) => row.name === "x")?.status).toBe("ready");

      const x = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(x?.name).toBe("x");
      expect((await store.complete(x!.id, x!.leaseToken!, null))).toEqual([]);
      expect((await store.list(jobId)).find((row) => row.name === "x")?.status).toBe("succeeded");
    });

    it("fails dependants when an expired final lease is swept", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "a", step: "a", input: null, deps: [], maxAttempts: 1 },
        { name: "b", step: "b", input: null, deps: ["a"], maxAttempts: 3 },
      ]);

      const a = await store.claim(crypto.randomUUID(), 1, jobId);
      expect(a?.name).toBe("a");
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(await store.claim(crypto.randomUUID(), 1, jobId)).toBeNull();
      expect((await store.list(jobId)).map(({ name, status }) => [name, status])).toEqual([
        ["a", "failed"],
        ["b", "failed"],
      ]);
    });

    it("fails a late-enqueued step whose dependency already failed", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "a", step: "a", input: null, deps: [], maxAttempts: 1 },
      ]);
      const a = await store.claim(crypto.randomUUID(), 330, jobId);
      await store.fail(a!.id, a!.leaseToken!, "failed");

      await store.enqueue(jobId, [
        { name: "after-review", step: "after-review", input: null, deps: ["a"], maxAttempts: 3 },
      ]);

      expect((await store.list(jobId)).find((row) => row.name === "after-review")).toMatchObject({
        status: "failed",
        error: "dependency failed: a",
      });
    });

    it("readies concurrent sibling joins reliably", async () => {
      const store = makeStore();
      for (let iteration = 0; iteration < 10; iteration += 1) {
        const jobId = crypto.randomUUID();
        await store.enqueue(jobId, [
          { name: "left", step: "left", input: null, deps: [], maxAttempts: 3 },
          { name: "right", step: "right", input: null, deps: [], maxAttempts: 3 },
          { name: "join", step: "join", input: null, deps: ["left", "right"], maxAttempts: 3 },
        ]);
        const [left, right] = await Promise.all([
          store.claim(crypto.randomUUID(), 330, jobId),
          store.claim(crypto.randomUUID(), 330, jobId),
        ]);
        expect(left).not.toBeNull();
        expect(right).not.toBeNull();
        await Promise.all([
          store.complete(left!.id, left!.leaseToken!, { side: "left" }),
          store.complete(right!.id, right!.leaseToken!, { side: "right" }),
        ]);
        expect((await store.list(jobId)).find((row) => row.name === "join")?.status).toBe("ready");
      }
    });

    it("retries failures through the configured maximum", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "retry", step: "retry", input: null, deps: [], maxAttempts: 2 },
      ]);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const claimed = await store.claim(crypto.randomUUID(), 330, jobId);
        expect(claimed?.attempts).toBe(attempt);
        const failed = await store.fail(claimed!.id, claimed!.leaseToken!, "temporary");
        expect(failed?.status).toBe(attempt === 1 ? "ready" : "failed");
      }
      expect(await store.claim(crypto.randomUUID(), 330, jobId)).toBeNull();
      expect((await store.list(jobId))[0]?.error).toBe("temporary");
    });

    it("ignores completion and failure with the wrong lease token", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "one", step: "one", input: null, deps: [], maxAttempts: 3 },
      ]);
      const claimed = await store.claim(crypto.randomUUID(), 330, jobId);
      expect(claimed).not.toBeNull();
      expect(await store.complete(claimed!.id, crypto.randomUUID(), null)).toEqual([]);
      expect(await store.fail(claimed!.id, crypto.randomUUID(), "wrong token")).toBeNull();
      const unchanged = (await store.list(jobId))[0]!;
      expect(unchanged.status).toBe("running");
      expect(unchanged.attempts).toBe(1);
      expect(unchanged.error).toBeNull();
    });

    it("starts later-enqueued steps ready when existing dependencies succeeded", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "review", step: "review", input: null, deps: [], maxAttempts: 3 },
      ]);
      const claimed = await store.claim(crypto.randomUUID(), 330, jobId);
      await store.complete(claimed!.id, claimed!.leaseToken!, null);
      await store.enqueue(jobId, [
        { name: "after-review", step: "after-review", input: null, deps: ["review"], maxAttempts: 3 },
      ]);
      expect((await store.list(jobId)).find((row) => row.name === "after-review")?.status).toBe("ready");
    });

    it("expires leases and fails an expired final attempt", async () => {
      const store = makeStore();
      const jobId = crypto.randomUUID();
      await store.enqueue(jobId, [
        { name: "expires", step: "expires", input: null, deps: [], maxAttempts: 1 },
      ]);
      const claimed = await store.claim(crypto.randomUUID(), 1, jobId);
      expect(claimed?.status).toBe("running");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await store.claim(crypto.randomUUID(), 1, jobId)).toBeNull();
      expect((await store.list(jobId))[0]?.error).toBe("lease expired after final attempt");
    });
  });
}
