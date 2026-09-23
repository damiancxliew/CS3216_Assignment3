import type { Point } from "@adventure/game-core";

export const MAX_PENDING_STEPS = 6;

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
