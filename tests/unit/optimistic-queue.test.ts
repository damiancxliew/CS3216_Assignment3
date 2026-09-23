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

  it("caps unacknowledged movement at six steps", () => {
    let queue: PendingStep[] = [];
    let position = point(0, 0);
    for (let i = 0; i < MAX_PENDING_STEPS; i += 1) {
      const next = optimisticAdvance(position, { to: point(i + 1, 0), inputAt: i, movedAt: i }, queue);
      expect(next).not.toBeNull();
      position = next!.position;
      queue = next!.queue;
    }
    expect(optimisticAdvance(position, { to: point(7, 0), inputAt: 7, movedAt: 7 }, queue)).toBeNull();
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
