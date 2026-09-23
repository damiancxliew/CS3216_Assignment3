/**
 * The Turn API's application layer: load the attempt, rehydrate the session,
 * settle an expired timer first, run one operation, persist what changed.
 *
 * Every entry point returns the full public state alongside its own result,
 * as the I3 contract requires, so the client never has to reconcile deltas.
 */
import type { LlmClient, ReplyResult } from "@adventure/orchestration";

import { PlaySession, type PlayState, type PlayerWorldAction, type SessionError, type SessionTimer } from "./session";
import { SpatialCompatibilityError } from "./layout";
import { RuntimeConflictError, type AttemptRecord, type PlayStore } from "./store";
import type { PublicMessage } from "@/lib/turn-api/contract";

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
  readonly = false,
): Promise<ServiceResult<T>> {
  let record: AttemptRecord | null;
  try {
    record = await deps.store.load(attemptId, userId);
  } catch (error) {
    if (error instanceof SpatialCompatibilityError) return { ok: false, error: { code: "incompatible_version", message: error.message } };
    throw error;
  }
  if (!record) return { ok: false, error: { code: "not_found", message: "No such attempt." } };
  if (record.status !== "active" && record.snapshot === null) return { ok: false, error: { code: "stage_closed", message: "This adventure is no longer active." } };
  if (!readonly && record.status !== "active") return { ok: false, error: { code: "stage_closed", message: "This adventure is no longer active." } };

  const now = await deps.store.now();
  const clock = { now: () => now };
  let session: PlaySession;
  try {
    session = record.snapshot
      ? PlaySession.resume(record.spec, attemptId, record.publishedVersion, record.snapshot, clock, record.assets ?? null, record.compiledStages)
      : PlaySession.start(record.spec, attemptId, record.publishedVersion, clock, record.assets ?? null, record.compiledStages);
  } catch (error) {
    if (error instanceof SpatialCompatibilityError) return { ok: false, error: { code: "incompatible_version", message: error.message } };
    throw error;
  }
  if (record.status === "active") session.expirePendingReply();
  const startRevision = record.snapshot?.revision ?? -1;

  // The deadline is server-held (D12/FR-16): if it has passed, the stage resolves before anything else.
  let timer = timerOf(record);
  if (record.status === "active" && timer.deadlineAt && now.getTime() >= new Date(timer.deadlineAt).getTime()) {
    await session.expire();
    timer = { enabled: false, deadlineAt: null };
  }

  const outcome = await operation(session);

  const after = session.snapshot();
  if (record.status === "active" && after.revision !== startRevision) {
    const events = session.drainEvents();
    // The store owns the deadline (P6): it restamps one when a stage opens, and tells us what it now holds.
    try {
      const saved = await deps.store.save(record, after, events);
      timer = { enabled: saved.stageDeadlineAt !== null, deadlineAt: saved.stageDeadlineAt };
    } catch (error) {
      // Someone else advanced this attempt while we worked. Say so, so the caller
      // reloads instead of retrying a write that can never succeed.
      if (error instanceof RuntimeConflictError) return { ok: false, error: { code: "stale_state", message: error.message } };
      throw error;
    }
  }

  if (!outcome.ok) return outcome;
  const state = session.state(timer);
  if (readonly && record.status !== "active") return { ok: true, value: outcome.value, state: { ...state, status: record.status, pendingDialogue: false, options: state.options.map((option) => ({ ...option, available: false, unavailableReason: "This attempt is no longer active." })) } };
  return { ok: true, value: outcome.value, state };
}

export async function getState(deps: PlayServiceDeps, attemptId: string, userId: string) {
  const read = () => run(deps, attemptId, userId, async () => ({ ok: true, value: null }), true);
  let result = await read();
  for (let retry = 0; !result.ok && result.error.code === "stale_state" && retry < 2; retry += 1) result = await read();
  return result;
}

export async function postMessage(deps: PlayServiceDeps, attemptId: string, userId: string, input: { roomId: string; body: string; addresseeId?: string | null }): Promise<ServiceResult<PublicMessage[]>> {
  const work: { produce?: () => Promise<ReplyResult> } = {};
  const initial = await run(deps, attemptId, userId, async (session) => {
    const begun = session.beginMessage(input);
    if (!begun.ok) return begun;
    if (begun.ticket) {
      const ticket = begun.ticket;
      work.produce = () => session.produceReply(deps.llm, ticket);
    } else {
      await session.maintainOptionsAfterTurn(deps.llm);
    }
    return { ok: true, value: begun };
  });
  if (!initial.ok) return initial;
  const ticket = initial.value.ticket;
  if (!ticket) return { ok: true, value: initial.value.newMessages, state: initial.state };
  let reply: ReplyResult | null = null;
  try { reply = await work.produce!(); } catch { reply = null; }
  for (let retry = 0; retry < 3; retry += 1) {
    const final = await run(deps, attemptId, userId, async (session) => {
      const completed = session.completeReply(ticket, reply);
      if (!completed.ok) return completed;
      await session.maintainOptionsAfterTurn(deps.llm);
      return { ok: true, value: completed.newMessages };
    });
    if (!final.ok) {
      if (final.error.code === "stale_state" && retry < 2) continue;
      return final;
    }
    const allowed = new Set(final.state.transcript.map((message) => message.id));
    const messages = [...initial.value.newMessages, ...final.value].filter((message, index, all) => allowed.has(message.id) && all.findIndex((candidate) => candidate.id === message.id) === index);
    return { ok: true, value: messages, state: final.state };
  }
  return { ok: false, error: { code: "stale_state", message: "The attempt changed. Refresh and try again." } };
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
