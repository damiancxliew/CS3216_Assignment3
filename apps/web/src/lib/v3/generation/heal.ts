/**
 * Self-healing for a lost tick: the progress poll decides whether to fire a
 * spare kick. A spare tick is harmless — the claim is atomic, so an empty tick
 * just returns ran:false.
 */
import type { JobProgress } from "@adventure/jobs";

/** No ready step may sit longer than this without activity before a kick fires. */
export const IDLE_MS = 10_000;
/** A running step older than this is treated as a dead function. */
export const STALE_RUNNING_MS = 300_000;
/** At most one poll kick per adventure within this window (per instance). */
export const KICK_COOLDOWN_MS = 10_000;

const stamp = (value: string | null): number | null => (value === null ? null : Date.parse(value));

export function shouldKick(steps: JobProgress["steps"], now: number): boolean {
  let latest: number | null = null;
  let hasReady = false;
  let hasStaleRunning = false;
  for (const step of steps) {
    const started = stamp(step.startedAt);
    const finished = stamp(step.finishedAt);
    for (const time of [started, finished]) if (time !== null && (latest === null || time > latest)) latest = time;
    if (step.status === "running") {
      // work is in flight only while the run is younger than the stale window;
      // claim_job_step reclaims expired leases, so an older run is dead
      if (started === null || now - started >= STALE_RUNNING_MS) hasStaleRunning = true;
      else return false;
    }
    if (step.status === "ready") hasReady = true;
  }
  if (hasStaleRunning) return true;
  if (!hasReady) return false;
  return latest === null || now - latest >= IDLE_MS;
}

/** One kick per adventure id per cooldown, per server instance. */
export function allowKick(seen: Map<string, number>, adventureId: string, now: number): boolean {
  const last = seen.get(adventureId);
  if (last !== undefined && now - last < KICK_COOLDOWN_MS) return false;
  seen.set(adventureId, now);
  return true;
}
