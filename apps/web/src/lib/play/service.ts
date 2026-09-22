/**
 * The Turn API's application layer: load the attempt, rehydrate the session,
 * settle an expired timer first, run one operation, persist what changed.
 *
 * Every entry point returns the full public state alongside its own result,
 * as the I3 contract requires, so the client never has to reconcile deltas.
 */
import type { LlmClient } from "@adventure/orchestration";

import { PlaySession, type PlayState, type PlayerWorldAction, type SessionError, type SessionTimer } from "./session";
import { PlayConflictError, type AttemptRecord, type PlayStore } from "./store";

export type ServiceResult<T> = { ok: true; value: T; state: PlayState } | { ok: false; error: SessionError };

export interface PlayServiceDeps {
  store: PlayStore;
  llm: LlmClient;
}

function timerOf(record: AttemptRecord): SessionTimer {
  return { enabled: record.stageDeadlineAt !== null, deadlineAt: record.stageDeadlineAt };
}

async function run<T>(
  deps: PlayServiceDeps,
  attemptId: string,
  userId: string,
  operation: (session: PlaySession) => Promise<{ ok: true; value: T } | { ok: false; error: SessionError }>,
): Promise<ServiceResult<T>> {
  const record = await deps.store.load(attemptId, userId);
  if (!record) return { ok: false, error: { code: "not_found", message: "No such attempt." } };

  const now = await deps.store.now();
  const clock = { now: () => now };
  const session = record.snapshot
    ? PlaySession.resume(record.spec, attemptId, record.publishedVersion, record.snapshot, clock)
    : PlaySession.start(record.spec, attemptId, record.publishedVersion, clock);
  const startRevision = record.snapshot?.revision ?? -1;

  // The deadline is server-held (D12/FR-16): if it has passed, the stage resolves before anything else.
  let timer = timerOf(record);
  if (record.status === "active" && timer.deadlineAt && now.getTime() >= new Date(timer.deadlineAt).getTime()) {
    await session.expire();
    timer = { enabled: false, deadlineAt: null };
  }

  const outcome = await operation(session);

  const after = session.snapshot();
  if (after.revision !== startRevision) {
    const events = session.drainEvents();
    // The store owns the deadline (P6): it restamps one when a stage opens, and tells us what it now holds.
    try {
      const saved = await deps.store.save(record, after, events);
      timer = { enabled: saved.stageDeadlineAt !== null, deadlineAt: saved.stageDeadlineAt };
    } catch (error) {
      if (error instanceof PlayConflictError) return { ok: false, error: { code: "stale_state", message: error.message } };
      throw error;
    }
  }

  if (!outcome.ok) return outcome;
  return { ok: true, value: outcome.value, state: session.state(timer) };
}

export function getState(deps: PlayServiceDeps, attemptId: string, userId: string) {
  return run(deps, attemptId, userId, async () => ({ ok: true, value: null }));
}

export function postMessage(deps: PlayServiceDeps, attemptId: string, userId: string, input: { roomId: string; body: string; addresseeId?: string | null }) {
  return run(deps, attemptId, userId, async (session) => {
    const result = await session.message(deps.llm, input);
    return result.ok ? { ok: true, value: result.newMessages } : result;
  });
}

export function postAction(deps: PlayServiceDeps, attemptId: string, userId: string, action: PlayerWorldAction) {
  return run(deps, attemptId, userId, async (session) => {
    const result = await session.action(deps.llm, action);
    return result.ok ? { ok: true, value: { refused: result.refused } } : result;
  });
}

export function postDecision(deps: PlayServiceDeps, attemptId: string, userId: string, input: { optionId: string; optionsVersion?: string }) {
  return run(deps, attemptId, userId, async (session) => {
    const result = await session.decide(deps.llm, input.optionId, input.optionsVersion);
    return result.ok ? { ok: true, value: result.resolution } : result;
  });
}
