import type { Point } from "@adventure/game-core";

/**
 * How far the walk may run ahead of the server. It only has to cover the steps a
 * player takes while a request is in flight, but it covers several seconds of them:
 * the server credits a late request with the tokens its steps earned, so a slow
 * round trip lengthens the queue instead of stopping the walk.
 */
export const MAX_PENDING_STEPS = 16;

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
