import { EngineError, EngineSpec, engine, pendingCheckIds, runPostTurnCheck, type EngineState } from "@adventure/engine";
import { Action } from "@adventure/play-contract";
import { createRng, type LlmClient } from "@adventure/orchestration";
import { z } from "zod";

import { v3SchoolAllowed } from "@/lib/v3/flag";

import { signPreviewState, verifyPreviewState } from "./preview-token";
import { ENGINE_ERROR_STATUS, limiterFor, type ServiceResponse } from "./service";
import type { V3PlayStore } from "./store";

export interface V3PreviewDeps {
  store: V3PlayStore;
  llm: (ctx: { organizationId: string; userId: string }) => LlmClient;
  now: () => number;
  env?: NodeJS.ProcessEnv;
  stateSecret?: string;
}

const PreviewActionRequest = z.strictObject({ token: z.string().min(1), action: Action });
const PreviewCheckRequest = z.strictObject({ token: z.string().min(1), messageId: z.string().min(1) });
const RESET_MESSAGE = "The preview can't continue. Restart it to play again.";

function error(status: number, code: string, message: string): ServiceResponse {
  return { status, body: { error: { code, message } } };
}

async function permittedPreview(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
) {
  const adventure = await deps.store.loadAdventure(adventureId);
  if (
    !adventure ||
    !v3SchoolAllowed(adventure.schoolId, deps.env) ||
    (adventure.ownerId !== userId && !(await deps.store.isSchoolAdmin(adventure.schoolId, userId)))
  ) {
    return error(404, "not_found", "Not found.");
  }
  if (adventure.spec === null) {
    return error(409, "not_ready", "This adventure has no story to preview yet.");
  }
  const parsed = EngineSpec.safeParse(adventure.spec);
  if (!parsed.success) {
    return error(409, "not_ready", "This adventure's story has errors to fix before it can be previewed.");
  }
  return { adventure, spec: parsed.data } as const;
}

function stepError(cause: unknown, context: string): ServiceResponse {
  if (cause instanceof EngineError) {
    return error(ENGINE_ERROR_STATUS[cause.code], cause.code, cause.message);
  }
  console.error(context, cause);
  return error(400, "preview_reset", RESET_MESSAGE);
}

function signState(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
  spec: unknown,
  state: EngineState,
): string {
  return signPreviewState(
    state,
    { userId, adventureId, spec },
    deps.stateSecret ?? deps.env?.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function verifyState(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
  spec: unknown,
  token: string,
): EngineState | null {
  return verifyPreviewState(
    token,
    { userId, adventureId, spec },
    deps.stateSecret ?? deps.env?.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export async function startPreview(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
): Promise<ServiceResponse> {
  const access = await permittedPreview(deps, userId, adventureId);
  if ("status" in access) return access;

  const state = engine.createState(access.spec, crypto.randomUUID());
  return {
    status: 201,
    body: {
      token: signState(deps, userId, adventureId, access.adventure.spec, state),
      view: engine.project(access.spec, state),
    },
  };
}

export async function previewAction(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
  body: unknown,
): Promise<ServiceResponse> {
  const access = await permittedPreview(deps, userId, adventureId);
  if ("status" in access) return access;
  const parsed = PreviewActionRequest.safeParse(body);
  if (!parsed.success) return error(400, "invalid_request", "Invalid preview action request.");
  const state = verifyState(deps, userId, adventureId, access.adventure.spec, parsed.data.token);
  if (!state) return error(400, "preview_reset", RESET_MESSAGE);
  if (!limiterFor(deps)(`preview:${userId}`)) {
    return error(429, "rate_limited", "You're moving too quickly. Please wait a moment and try again.");
  }
  const llm = deps.llm({ organizationId: access.adventure.schoolId, userId });
  try {
    const result = await engine.step(
      { spec: access.spec, state, action: parsed.data.action },
      {
        llm,
        now: deps.now(),
        rng: createRng(`preview:${adventureId}:${crypto.randomUUID()}`),
      },
    );
    return {
      status: 200,
      body: {
        token: signState(deps, userId, adventureId, access.adventure.spec, result.state),
        view: result.view,
        pendingCheckIds: pendingCheckIds(result.state),
      },
    };
  } catch (cause) {
    return stepError(cause, "Failed to run v3 preview action");
  }
}

export async function previewCheck(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
  body: unknown,
): Promise<ServiceResponse> {
  const access = await permittedPreview(deps, userId, adventureId);
  if ("status" in access) return access;
  const parsed = PreviewCheckRequest.safeParse(body);
  if (!parsed.success) return error(400, "invalid_request", "Invalid preview check request.");
  const state = verifyState(deps, userId, adventureId, access.adventure.spec, parsed.data.token);
  if (!state) return error(400, "preview_reset", RESET_MESSAGE);
  if (!limiterFor(deps)(`preview:${userId}`)) {
    return error(429, "rate_limited", "You're moving too quickly. Please wait a moment and try again.");
  }
  const llm = deps.llm({ organizationId: access.adventure.schoolId, userId });
  try {
    if (!pendingCheckIds(state).includes(parsed.data.messageId)) {
      return {
        status: 200,
        body: {
          token: parsed.data.token,
          view: engine.project(access.spec, state),
          pendingCheckIds: pendingCheckIds(state),
        },
      };
    }
    const result = await runPostTurnCheck(access.spec, state, parsed.data.messageId, { llm });
    const stepped = await engine.step(
      {
        spec: access.spec,
        state,
        action: { type: "postTurn", messageId: parsed.data.messageId, result },
      },
      {
        llm,
        now: deps.now(),
        rng: createRng(`preview:${adventureId}:${crypto.randomUUID()}`),
      },
    );
    return {
      status: 200,
      body: {
        token: signState(deps, userId, adventureId, access.adventure.spec, stepped.state),
        view: stepped.view,
        pendingCheckIds: pendingCheckIds(stepped.state),
      },
    };
  } catch (cause) {
    return stepError(cause, "Failed to run v3 preview check");
  }
}
