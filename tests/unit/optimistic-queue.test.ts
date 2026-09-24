import { describe, expect, it } from "vitest";

import { MAX_PENDING_STEPS, optimisticAdvance, settleBatch, type PendingStep } from "@/lib/play/optimistic-queue";

const point = (x: number, y: number) => ({ x, y });
const step = (from: { x: number; y: number }, to: { x: number; y: number }): PendingStep => ({
  from,
  to,
  inputAt: 1,
  movedAt: 2,
});

describe("optimistic movement queue", () => {
  it("advances locally and drops only acknowledged steps", () => {
    const first = optimisticAdvance(point(0, 0), { to: point(1, 0), inputAt: 1, movedAt: 2 }, []);
    expect(first).toEqual({ position: point(1, 0), queue: [step(point(0, 0), point(1, 0))] });
    expect(settleBatch(first!.queue, "accepted", 1)).toEqual([]);
  });

  it("caps unacknowledged movement at the queue depth", () => {
    let queue: PendingStep[] = [];
    let position = point(0, 0);
    for (let i = 0; i < MAX_PENDING_STEPS; i += 1) {
      const next = optimisticAdvance(position, { to: point(i + 1, 0), inputAt: i, movedAt: i }, queue);
      expect(next).not.toBeNull();
      position = next!.position;
      queue = next!.queue;
    }
    expect(optimisticAdvance(position, { to: point(MAX_PENDING_STEPS + 1, 0), inputAt: 7, movedAt: 7 }, queue)).toBeNull();
  });

  it("keeps a held direction moving across the longest possible map axis while an acknowledgement is slow", () => {
    let queue: PendingStep[] = [];
    let position = point(0, 0);
    // Maps are at most 128 tiles wide or tall, so crossing one from edge to edge
    // requires at most 127 uninterrupted steps.
    for (let x = 1; x < 128; x += 1) {
      const next = optimisticAdvance(position, { to: point(x, 0), inputAt: x, movedAt: x }, queue);
      expect(next).not.toBeNull();
      position = next!.position;
      queue = next!.queue;
    }
    expect(position).toEqual(point(127, 0));
  });

  it("keeps the head for rate-limit retries and clears on rollback", () => {
    const queue = [step(point(0, 0), point(1, 0)), step(point(1, 0), point(2, 0))];
    expect(settleBatch(queue, "retry", 1)).toEqual(queue);
    expect(settleBatch(queue, "rollback", 1)).toEqual([]);
  });

  it("drops only the sent prefix when steps are appended in flight", () => {
    const queue = [
      step(point(0, 0), point(1, 0)),
      step(point(1, 0), point(2, 0)),
      step(point(2, 0), point(3, 0)),
    ];
    expect(settleBatch(queue, "accepted", 2)).toEqual([queue[2]]);
  });
});
