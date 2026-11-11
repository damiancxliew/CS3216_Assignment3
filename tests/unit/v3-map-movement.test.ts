import { afterEach, describe, expect, it, vi } from "vitest";

import { createHeldKeyMover, createRoomEntrySync } from "@/lib/play/v3/map";

function deferred() {
  let resolve!: (accepted: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(initialRoom: string | null) {
  const state = { server: initialRoom, place: initialRoom as string | null, settled: 0, now: 0 };
  const calls: Array<{ roomId: string; resolve: (accepted: boolean) => void }> = [];
  const sync = createRoomEntrySync({
    enter: (roomId) => {
      const entry = deferred();
      calls.push({ roomId, resolve: (accepted) => {
        if (accepted) state.server = roomId;
        entry.resolve(accepted);
      } });
      return entry.promise;
    },
    serverRoom: () => state.server,
    place: () => state.place,
    onSettled: () => { state.settled += 1; },
    retryAfterMs: 2_000,
    now: () => state.now,
  });
  const walk = (place: string | null) => {
    state.place = place;
    sync.arrive(place);
  };
  const flush = () => new Promise((done) => setTimeout(done, 0));
  return { state, calls, sync, walk, flush };
}

describe("room entry sync under latency", () => {
  it("never blocks movement and sends entries one at a time, in order, coalescing to the latest room", async () => {
    const { calls, sync, walk, flush } = harness("a");
    walk("b");
    expect(calls.map((call) => call.roomId)).toEqual(["b"]);
    expect(sync.pending()).toBe(true);
    // The player keeps walking: out through c into d while b is still in flight.
    walk(null);
    walk("c");
    walk("d");
    expect(calls.map((call) => call.roomId)).toEqual(["b"]);
    expect(sync.claimed()).toBe("d");
    calls[0]!.resolve(true);
    await flush();
    expect(calls.map((call) => call.roomId)).toEqual(["b", "d"]);
    calls[1]!.resolve(true);
    await flush();
    expect(sync.pending()).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("skips a queued room the player has already come back from", async () => {
    const { calls, walk, flush } = harness("a");
    walk("b");
    walk("a");
    walk("b");
    calls[0]!.resolve(true);
    await flush();
    expect(calls.map((call) => call.roomId)).toEqual(["b"]);
  });

  it("keeps the player in place after a rejection and retries once they step out and back in", async () => {
    const { state, calls, sync, walk, flush } = harness("a");
    walk("b");
    calls[0]!.resolve(false);
    await flush();
    expect(state.settled).toBe(1);
    expect(sync.claimed()).toBe("a");
    walk("b");
    expect(calls).toHaveLength(1);
    walk(null);
    walk("b");
    expect(calls.map((call) => call.roomId)).toEqual(["b", "b"]);
  });

  it("retries a rejected room on a later step inside it once the cool-down has passed", async () => {
    const { state, calls, walk, flush } = harness("a");
    walk("b");
    calls[0]!.resolve(false);
    await flush();
    state.now = 1_000;
    walk("b");
    expect(calls).toHaveLength(1);
    state.now = 2_500;
    walk("b");
    expect(calls.map((call) => call.roomId)).toEqual(["b", "b"]);
  });

  it("follows the server's room when it changes while idle", () => {
    const { state, calls, sync, walk } = harness(null);
    state.server = "c";
    sync.sync();
    walk("c");
    expect(calls).toHaveLength(0);
  });
});

describe("held movement keys", () => {
  afterEach(() => vi.useRealTimers());

  it("moves exactly one tile for a tap, even a slightly long one", () => {
    vi.useFakeTimers();
    const step = vi.fn();
    const keys = createHeldKeyMover({ step, canRepeat: () => true, initialDelayMs: 240, intervalMs: 160 });
    keys.press("ArrowDown", { x: 0, y: 1 });
    vi.advanceTimersByTime(200);
    keys.release("ArrowDown");
    vi.advanceTimersByTime(1000);
    expect(step).toHaveBeenCalledTimes(1);
    expect(keys.active()).toBe(false);
  });

  it("auto-repeats after the initial delay at a steady cadence, and stops on release", () => {
    vi.useFakeTimers();
    const step = vi.fn();
    const keys = createHeldKeyMover({ step, canRepeat: () => true, initialDelayMs: 240, intervalMs: 160 });
    keys.press("KeyD", { x: 1, y: 0 });
    vi.advanceTimersByTime(239);
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(step).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(320);
    expect(step).toHaveBeenCalledTimes(4);
    keys.release("KeyD");
    vi.advanceTimersByTime(1000);
    expect(step).toHaveBeenCalledTimes(4);
  });

  it("stops repeating as soon as movement locks, even if the key-up never arrives", () => {
    vi.useFakeTimers();
    const step = vi.fn();
    let locked = false;
    const keys = createHeldKeyMover({ step, canRepeat: () => !locked, initialDelayMs: 240, intervalMs: 160 });
    keys.press("ArrowUp", { x: 0, y: -1 });
    vi.advanceTimersByTime(400);
    expect(step).toHaveBeenCalledTimes(3);
    locked = true;
    vi.advanceTimersByTime(1000);
    expect(step).toHaveBeenCalledTimes(3);
    expect(keys.active()).toBe(false);
  });

  it("restarts the delay for a second key so its own step is not followed by an instant repeat", () => {
    vi.useFakeTimers();
    const step = vi.fn();
    const keys = createHeldKeyMover({ step, canRepeat: () => true, initialDelayMs: 240, intervalMs: 160 });
    keys.press("ArrowUp", { x: 0, y: -1 });
    vi.advanceTimersByTime(380);
    keys.press("ArrowLeft", { x: -1, y: 0 });
    expect(step).toHaveBeenLastCalledWith({ x: -1, y: 0 });
    const count = step.mock.calls.length;
    vi.advanceTimersByTime(200);
    expect(step).toHaveBeenCalledTimes(count);
    keys.release("ArrowLeft");
    vi.advanceTimersByTime(40);
    expect(step).toHaveBeenLastCalledWith({ x: 0, y: -1 });
    keys.clear();
  });

  it("ignores a second press of a key already held", () => {
    const step = vi.fn();
    const keys = createHeldKeyMover({ step, canRepeat: () => true });
    keys.press("KeyW", { x: 0, y: -1 });
    keys.press("KeyW", { x: 0, y: -1 });
    expect(step).toHaveBeenCalledTimes(1);
    keys.clear();
  });
});
