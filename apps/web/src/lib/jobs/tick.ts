import { createHash, timingSafeEqual } from "node:crypto";

import type { createJobs, RunResult } from "@adventure/jobs";
import { v3Enabled } from "@/lib/v3/flag";

export const TICK_SECRET_HEADER = "x-jobs-tick-secret";

export type TickOutcome = {
  status: number;
  body: { ran: false } | { ran: true; result: RunResult } | { error: string };
  kicks: number;
};

export async function handleTick(opts: {
  getJobs: () => Pick<ReturnType<typeof createJobs>, "runNext">;
  secretHeader: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<TickOutcome> {
  const env = opts.env ?? process.env;
  if (!v3Enabled(env)) return { status: 404, body: { error: "not_found" }, kicks: 0 };

  const secret = env.JOBS_TICK_SECRET;
  if (!secret) return { status: 503, body: { error: "not_configured" }, kicks: 0 };

  if (!opts.secretHeader) return { status: 401, body: { error: "unauthorized" }, kicks: 0 };

  const expected = createHash("sha256").update(secret).digest();
  const received = createHash("sha256").update(opts.secretHeader).digest();
  if (!timingSafeEqual(expected, received)) {
    return { status: 401, body: { error: "unauthorized" }, kicks: 0 };
  }

  let result: RunResult | null;
  try {
    result = await opts.getJobs().runNext();
  } catch (error) {
    // A transient claim or database failure: report it cleanly and let the next tick (or the timer) retry.
    console.error("jobs tick failed", error);
    return { status: 500, body: { error: "tick_failed" }, kicks: 0 };
  }
  if (result === null) return { status: 200, body: { ran: false }, kicks: 0 };

  return {
    status: 200,
    body: { ran: true, result },
    kicks: result.status === "succeeded" ? Math.max(1, result.readied.length) : 1,
  };
}

export function tickUrl(requestUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.JOBS_TICK_URL || new URL("/api/v3/jobs/tick", requestUrl).toString();
}
