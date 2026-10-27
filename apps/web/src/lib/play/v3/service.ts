import { EngineError, EngineSpec, engine, pendingCheckIds, runPostTurnCheck, type EngineState } from "@adventure/engine";
import { Action, type GameEvent } from "@adventure/play-contract";
import { createRng, type LlmClient } from "@adventure/orchestration";
import { z } from "zod";

import { v3SchoolAllowed } from "@/lib/v3/flag";

import { createRateLimiter } from "./rate-limit";
import type { V3Attempt, V3FlagInput, V3PlayStore } from "./store";

type LlmContext = { attemptId: string; organizationId: string; userId: string };

export interface V3PlayServiceDeps {
  store: V3PlayStore;
  llm: (context: LlmContext) => LlmClient;
  now: () => number;
  env?: NodeJS.ProcessEnv;
}

export type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

const ActionRequest = z.strictObject({
  revision: z.number().int().nonnegative(),
  action: Action,
});

export const ENGINE_ERROR_STATUS: Record<EngineError["code"], number> = {
  invalid_action: 400,
  unknown_id: 400,
  illegal_phase: 409,
  not_present: 409,
  not_held: 409,
  act_unavailable: 409,
  pending: 409,
  preparation_required: 409,
};

const costlyActions = new Set(["message", "insertNote", "interviewAnswer"]);
const DEFAULT_TOKEN_CEILING = 1_500_000;
const DEFAULT_RATE_LIMIT = 20;
const rateLimiters = new WeakMap<V3PlayStore, {
  limit: number;
  now: () => number;
  allow: (key: string) => boolean;
}>();

function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ServiceResponse {
  return { status, body: { error: { code, message }, ...extra } };
}

function integerSetting(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

type RateLimitDeps = Pick<V3PlayServiceDeps, "store" | "now" | "env">;

export function limiterFor(deps: RateLimitDeps): (key: string) => boolean {
  const limit = integerSetting(deps.env?.V3_RATE_LIMIT_PER_10S, DEFAULT_RATE_LIMIT);
  const current = rateLimiters.get(deps.store);
  if (current?.limit === limit && current.now === deps.now) return current.allow;
  const allow = createRateLimiter({ limit, windowMs: 10_000, now: deps.now });
  rateLimiters.set(deps.store, { limit, now: deps.now, allow });
  return allow;
}

function tokenCeiling(env: NodeJS.ProcessEnv | undefined): number {
  return integerSetting(env?.V3_ATTEMPT_TOKEN_CEILING, DEFAULT_TOKEN_CEILING);
}

async function permittedAdventure(
  deps: V3PlayServiceDeps,
  userId: string,
  adventureId: string,
) {
  const adventure = await deps.store.loadAdventure(adventureId);
  if (
    !adventure ||
    !v3SchoolAllowed(adventure.schoolId, deps.env) ||
    !(await deps.store.isActiveMember(adventure.schoolId, userId))
  ) {
    return null;
  }
  return adventure;
}

async function pinnedSpec(deps: V3PlayServiceDeps, attempt: V3Attempt) {
  const raw = await deps.store.loadVersionSpec(attempt.adventureId, attempt.specVersion);
  if (raw === null) throw new Error(`Missing pinned v3 spec ${attempt.adventureId}:${attempt.specVersion}`);
  return EngineSpec.parse(raw);
}

function staleState(revision: number, view: ReturnType<typeof engine.project>): ServiceResponse {
  return error(409, "stale_state", "This attempt has changed. Refresh before trying again.", {
    revision,
    view,
  });
}

async function currentView(deps: V3PlayServiceDeps, attempt: V3Attempt) {
  const spec = await pinnedSpec(deps, attempt);
  return engine.project(spec, attempt.state as EngineState);
}

export async function createAttempt(
  deps: V3PlayServiceDeps,
  userId: string,
  adventureId: string,
  release?: string,
): Promise<ServiceResponse> {
  let adventure = await permittedAdventure(deps, userId, adventureId);
  if (!adventure) return error(404, "not_found", "Not found.");
  if (adventure.status !== "published" || adventure.spec === null) {
    return error(409, "not_open", "This adventure is not open for play.");
  }

  const publication = release ? (await deps.store.listPublications(adventureId)).find(p => p.linkKey === release) : undefined;
  if (release && !publication) return error(404, "not_found", "Not found.");
  const existing = await deps.store.findLatestAttempt(adventure.id, userId, publication?.version);
  if (existing) {
    const view = await currentView(deps, existing);
    return {
      status: 200,
      body: { attemptId: existing.id, revision: existing.revision, view, resumed: true },
    };
  }

  for (let retry = 0; retry < 3; retry++) {
    if (adventure.status !== "published" || adventure.publishedVersion == null) return error(409, "not_open", "This adventure is not open for play.");
    const version = publication?.version ?? adventure.publishedVersion;
    const rawSpec = await deps.store.loadVersionSpec(adventure.id, version);
    if (rawSpec === null) throw new Error(`Missing published v3 spec ${adventure.id}:${version}`);
    const spec = EngineSpec.parse(rawSpec);
    const state = engine.createState(spec, crypto.randomUUID());
    const attempt = await deps.store.createAttempt({ adventureId: adventure.id, specVersion: version, studentId: userId, state, ...(release ? { release } : {}) });
    if (attempt) return {
      status: 201,
      body: { attemptId: attempt.id, revision: attempt.revision, view: engine.project(spec, state), resumed: false },
    };
    const latest = await permittedAdventure(deps, userId, adventureId);
    if (!latest) return error(404, "not_found", "Not found.");
    adventure = latest;
  }
  return error(409, "conflict", "Publication changed. Try starting again.");
}

export async function getAttempt(
  deps: V3PlayServiceDeps,
  userId: string,
  attemptId: string,
): Promise<ServiceResponse> {
  const attempt = await deps.store.loadAttempt(attemptId);
  if (
    !attempt ||
    attempt.studentId !== userId ||
    !v3SchoolAllowed(attempt.schoolId, deps.env) ||
    !(await deps.store.isActiveMember(attempt.schoolId, userId))
  ) {
    return error(404, "not_found", "Not found.");
  }

  const view = await currentView(deps, attempt);
  return {
    status: 200,
    body: { attemptId: attempt.id, revision: attempt.revision, view },
  };
}

export async function postAction(
  deps: V3PlayServiceDeps,
  userId: string,
  attemptId: string,
  body: unknown,
): Promise<ServiceResponse> {
  const parsed = ActionRequest.safeParse(body);
  if (!parsed.success) return error(400, "invalid_request", "Invalid action request.");

  const attempt = await deps.store.loadAttempt(attemptId);
  if (
    !attempt ||
    attempt.studentId !== userId ||
    !v3SchoolAllowed(attempt.schoolId, deps.env) ||
    !(await deps.store.isActiveMember(attempt.schoolId, userId))
  ) {
    return error(404, "not_found", "Not found.");
  }

  if (!limiterFor(deps)(attemptId)) {
    return error(429, "rate_limited", "You're moving too quickly. Please wait a moment and try again.");
  }

  const spec = await pinnedSpec(deps, attempt);
  const state = attempt.state as EngineState;
  if (attempt.revision !== parsed.data.revision) return staleState(attempt.revision, engine.project(spec, state));

  if (
    costlyActions.has(parsed.data.action.type) &&
    (await deps.store.tokensUsed(attempt.id)) >= tokenCeiling(deps.env)
  ) {
    return error(
      429,
      "attempt_limit",
      "This attempt has reached its limit. Your notes are saved; ask your teacher to continue.",
    );
  }

  const llm = deps.llm({
    attemptId: attempt.id,
    organizationId: attempt.schoolId,
    userId,
  });
  let result;
  try {
    result = await engine.step(
      { spec, state, action: parsed.data.action },
      { llm, now: deps.now(), rng: createRng(`${attemptId}:${attempt.revision}`) },
    );
  } catch (cause) {
    if (cause instanceof EngineError) {
      return error(ENGINE_ERROR_STATUS[cause.code], cause.code, cause.message);
    }
    throw cause;
  }

  const saved = await deps.store.save(attempt.id, attempt.revision, result.state, result.events as GameEvent[]);
  if (!saved.saved) {
    const latest = await deps.store.loadAttempt(attempt.id);
    if (!latest || latest.studentId !== userId) return error(404, "not_found", "Not found.");
    return staleState(latest.revision, await currentView(deps, latest));
  }

  return {
    status: 200,
    body: {
      revision: saved.revision,
      view: result.view,
      pendingCheckIds: pendingCheckIds(result.state),
    },
  };
}

export async function runPostTurnChecks(
  deps: V3PlayServiceDeps,
  attemptId: string,
  messageIds: readonly string[],
): Promise<void> {
  for (const messageId of new Set(messageIds)) {
    let checkResult: Awaited<ReturnType<typeof runPostTurnCheck>> | null = null;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const attempt = await deps.store.loadAttempt(attemptId);
        if (!attempt) break;
        const spec = await pinnedSpec(deps, attempt);
        const state = attempt.state as EngineState;
        const pending = state.pendingChecks.find((check) => check.messageId === messageId);
        if (pending === undefined) break;

        const llm = deps.llm({
          attemptId: attempt.id,
          organizationId: attempt.schoolId,
          userId: attempt.studentId,
        });
        checkResult ??= await runPostTurnCheck(spec, state, messageId, { llm });
        const result = await engine.step(
          { spec, state, action: { type: "postTurn", messageId, result: checkResult } },
          { llm, now: deps.now(), rng: createRng(`${attempt.id}:${attempt.revision}`) },
        );
        const flags = flagsFromEvents(pending, result.events);
        const saved = await deps.store.save(
          attempt.id,
          attempt.revision,
          result.state,
          result.events as GameEvent[],
          flags,
        );
        if (saved.saved) break;
      } catch (cause) {
        console.error("Failed to run v3 post-turn check", cause);
        break;
      }
    }
  }
}

export function flagsFromEvents(
  pending: EngineState["pendingChecks"][number],
  events: readonly GameEvent[],
): V3FlagInput[] {
  const excerpt = (
    pending.turn.kind === "message"
      ? pending.turn.text
      : [pending.turn.text, pending.turn.note].filter(Boolean).join("\n")
  ).trim().slice(0, 1000);

  return events.flatMap((event) => (
    event.type === "flag" && event.messageId === pending.messageId
      ? [{
          messageId: event.messageId,
          category: event.category,
          excerpt,
          result: {
            reason: event.reason,
            characterId: pending.characterId,
            stageIndex: pending.stageIndex,
          },
        }]
      : []
  ));
}
