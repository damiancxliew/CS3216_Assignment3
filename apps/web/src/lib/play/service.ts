/**
 * The Turn API's application layer: load the attempt, rehydrate the session,
 * settle an expired timer first, run one operation, persist what changed.
 *
 * Every entry point returns the full public state alongside its own result,
 * as the I3 contract requires, so the client never has to reconcile deltas.
 */
import type { LlmClient, ReplyResult } from "@adventure/orchestration";

import { PlaySession, type MessageBeginOutcome, type MintProduction, type PendingMint, type PlayState, type PlayerWorldAction, type SessionError, type SessionTimer } from "./session";
import { SpatialCompatibilityError } from "./layout";
import { RuntimeConflictError, type AttemptRecord, type PlayStore } from "./store";
import type { PublicMessage } from "@/lib/turn-api/contract";
import type { PlayTimings } from "./timing";

export type ServiceResult<T> = { ok: true; value: T; state: PlayState } | { ok: false; error: SessionError };

export interface PlayServiceDeps {
  store: PlayStore;
  llm: LlmClient;
  timings?: PlayTimings;
}

function timerOf(record: AttemptRecord): SessionTimer {
  return { enabled: record.stageDeadlineAt !== null, deadlineAt: record.stageDeadlineAt };
}

async function runInternal<T>(
  deps: PlayServiceDeps,
  attemptId: string,
  userId: string,
  operation: (session: PlaySession) => Promise<{ ok: true; value: T } | { ok: false; error: SessionError }>,
  readonly = false,
): Promise<ServiceResult<T>> {
  let record: AttemptRecord | null;
  try {
    record = await deps.store.load(attemptId, userId, deps.timings);
  } catch (error) {
    if (error instanceof SpatialCompatibilityError) return { ok: false, error: { code: "incompatible_version", message: error.message } };
    throw error;
  }
  if (!record) return { ok: false, error: { code: "not_found", message: "No such attempt." } };
  if (record.status !== "active" && record.snapshot === null) return { ok: false, error: { code: "stage_closed", message: "This adventure is no longer active." } };
  if (!readonly && record.status !== "active") return { ok: false, error: { code: "stage_closed", message: "This adventure is no longer active." } };

  const now = deps.timings ? await deps.timings.time("now", () => deps.store.now()) : await deps.store.now();
  const clock = { now: () => now };
  let session: PlaySession;
  try {
    session = deps.timings
      ? await deps.timings.time("rehydrate", () => record.snapshot
        ? PlaySession.resume(record.spec, attemptId, record.publishedVersion, record.snapshot, clock, record.assets ?? null, record.compiledStages)
        : PlaySession.start(record.spec, attemptId, record.publishedVersion, clock, record.assets ?? null, record.compiledStages))
      : record.snapshot
        ? PlaySession.resume(record.spec, attemptId, record.publishedVersion, record.snapshot, clock, record.assets ?? null, record.compiledStages)
        : PlaySession.start(record.spec, attemptId, record.publishedVersion, clock, record.assets ?? null, record.compiledStages);
  } catch (error) {
    if (error instanceof SpatialCompatibilityError) return { ok: false, error: { code: "incompatible_version", message: error.message } };
    throw error;
  }
  const startRevision = record.snapshot?.revision ?? -1;

  // The deadline is server-held (D12/FR-16): if it has passed, the stage resolves before anything else.
  let timer = timerOf(record);
  if (record.status === "active" && timer.deadlineAt && now.getTime() >= new Date(timer.deadlineAt).getTime()) {
    await session.expire();
    timer = { enabled: false, deadlineAt: null };
  }

  const outcome = deps.timings ? await deps.timings.time("op", () => operation(session)) : await operation(session);

  const after = session.snapshot();
  if (record.status === "active" && after.revision !== startRevision) {
    const events = session.drainEvents();
    // The store owns the deadline (P6): it restamps one when a stage opens, and tells us what it now holds.
    try {
      const saved = await deps.store.save(record, after, events, deps.timings);
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

async function run<T>(
  deps: PlayServiceDeps,
  attemptId: string,
  userId: string,
  operation: (session: PlaySession) => Promise<{ ok: true; value: T } | { ok: false; error: SessionError }>,
  readonly = false,
): Promise<ServiceResult<T>> {
  return deps.timings ? deps.timings.time("total", () => runInternal(deps, attemptId, userId, operation, readonly)) : runInternal(deps, attemptId, userId, operation, readonly);
}

export async function getState(deps: PlayServiceDeps, attemptId: string, userId: string) {
  const read = () => run(deps, attemptId, userId, async () => ({ ok: true, value: null }), true);
  let result = await read();
  for (let retry = 0; !result.ok && result.error.code === "stale_state" && retry < 2; retry += 1) result = await read();
  return result;
}

export async function postMintOptions(deps: PlayServiceDeps, attemptId: string, userId: string): Promise<ServiceResult<null>> {
  const work: { ticket?: PendingMint; produce?: () => Promise<MintProduction> } = {};
  const initial = await run(deps, attemptId, userId, async (session) => {
    const ticket = session.beginMint();
    if (ticket) {
      work.ticket = ticket;
      work.produce = () => session.produceMint(deps.llm, ticket);
    }
    return { ok: true, value: null };
  });
  if (!initial.ok || !work.ticket || !work.produce) return initial;

  let output: MintProduction | null = null;
  try { output = await work.produce(); } catch { output = null; }
  for (let retry = 0; retry < 3; retry += 1) {
    const final = await run(deps, attemptId, userId, async (session) => {
      session.completeMint(work.ticket!, output);
      return { ok: true, value: null };
    });
    if (!final.ok) {
      if (final.error.code === "stale_state" && retry < 2) continue;
      if (final.error.code === "stage_closed") {
        const latest = await getState(deps, attemptId, userId);
        return latest.ok ? { ok: true, value: null, state: latest.state } : latest;
      }
      return final;
    }
    return final;
  }
  return { ok: false, error: { code: "stale_state", message: "The attempt changed. Refresh and try again." } };
}

export async function postMessage(deps: PlayServiceDeps, attemptId: string, userId: string, input: { roomId: string; body: string; addresseeId?: string | null }): Promise<ServiceResult<PublicMessage[]>> {
  let initial: ServiceResult<Extract<MessageBeginOutcome, { ok: true }>> | null = null;
  let produce: (() => Promise<ReplyResult>) | undefined;
  for (let retry = 0; retry < 3; retry += 1) {
    const work: { produce?: () => Promise<ReplyResult> } = {};
    const begun = await run(deps, attemptId, userId, async (session) => {
      const result = session.beginMessage(input);
      if (!result.ok) return result;
      if (result.ticket) {
        const ticket = result.ticket;
        work.produce = () => session.produceReply(deps.llm, ticket);
      }
      return { ok: true, value: result };
    });
    if (!begun.ok) {
      if (begun.error.code === "stale_state" && retry < 2) continue;
      return begun;
    }
    initial = begun;
    produce = work.produce;
    break;
  }
  if (initial === null) return { ok: false, error: { code: "stale_state", message: "The attempt changed. Refresh and try again." } };
  if (!initial.ok) return initial;
  const ticket = initial.value.ticket;
  if (!ticket) return { ok: true, value: initial.value.newMessages, state: initial.state };
  let reply: ReplyResult | null = null;
  try { reply = await produce!(); } catch { reply = null; }
  for (let retry = 0; retry < 3; retry += 1) {
    const final = await run(deps, attemptId, userId, async (session) => {
      const completed = session.completeReply(ticket, reply);
      if (!completed.ok) return completed;
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

export async function postAction(deps: PlayServiceDeps, attemptId: string, userId: string, action: PlayerWorldAction) {
  const runAction = () => run(deps, attemptId, userId, async (session) => {
    const result = await session.action(deps.llm, action);
    return result.ok ? { ok: true, value: { refused: result.refused } } : result;
  });
  const retryable = action.type === "move_step" || action.type === "move_steps" || action.type === "move_room" || action.type === "inspect" || action.type === "position" || action.type === "open_door" || action.type === "close_door" || action.type === "share_evidence";
  let result = await runAction();
  for (let retry = 0; retry < 2 && retryable && !result.ok && result.error.code === "stale_state"; retry += 1) result = await runAction();
  return result;
}

export function postDecision(deps: PlayServiceDeps, attemptId: string, userId: string, input: { optionId: string; optionsVersion?: string }) {
  return run(deps, attemptId, userId, async (session) => {
    const result = await session.decide(deps.llm, input.optionId, input.optionsVersion);
    return result.ok ? { ok: true, value: result.resolution } : result;
  });
}
