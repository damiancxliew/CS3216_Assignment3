import type { Point } from "@adventure/game-core";

/**
 * How far the walk may run ahead of the server. Stage maps are validated at no
 * more than 128 tiles on either axis, so this lets a held direction reach the
 * opposite edge even when one unusually slow request is still in flight. The
 * cap remains finite so a lost response cannot grow the queue forever.
 */
export const MAX_PENDING_STEPS = 128;

/** The server takes at most eight steps per request. */
export const MAX_STEPS_PER_REQUEST = 8;

export interface PendingStep {
  from: Point;
  to: Point;
  inputAt: number;
  movedAt: number;
  requestSentAt?: number;
}

export type StepSettlement = "accepted" | "retry" | "rollback";

export function optimisticAdvance(
  position: Point,
  step: Omit<PendingStep, "from"> & { to: Point },
  queue: readonly PendingStep[],
): { position: Point; queue: PendingStep[] } | null {
  if (queue.length >= MAX_PENDING_STEPS) return null;
  return {
    position: step.to,
    queue: [...queue, { ...step, from: position }],
  };
}

export function settleBatch(
  queue: readonly PendingStep[],
  settlement: StepSettlement,
  sentCount: number,
): PendingStep[] {
  if (settlement === "accepted") return queue.slice(sentCount);
  if (settlement === "retry") return [...queue];
  return [];
}
