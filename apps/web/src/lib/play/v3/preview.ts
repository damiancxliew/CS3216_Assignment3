import { EngineError, engine, pendingCheckIds, previewInsight, runPostTurnCheck, type EngineSpec, type EngineState } from "@adventure/engine";
import { Action } from "@adventure/play-contract";
import { createRng, type LlmClient } from "@adventure/orchestration";
import { z } from "zod";
import { decodeStoredSpec, validateSpec } from "@adventure/spec-v3";

import { applyTeacherEdits } from "@/lib/v3/edit/apply";
import { V3Edit, type CapturedSource } from "@/lib/v3/edit/commands";

import { canStaffAdventure } from "./access";
import { signPreviewState, verifyPreviewState } from "./preview-token";
import { ENGINE_ERROR_STATUS, limiterFor, type ServiceResponse } from "./service";
import type { V3PlayStore } from "./store";

export interface V3PreviewDeps {
  store: V3PlayStore;
  llm: (ctx: { organizationId: string; userId: string }) => LlmClient;
  now: () => number;
  env?: NodeJS.ProcessEnv;
  stateSecret?: string;
  /** Source text for teacher draft edits that quote a source. */
  sources?: (adventureId: string) => Promise<CapturedSource[]>;
}

/** Unsaved teacher edits on top of the saved version, so the preview plays the draft. */
const PreviewDraft = z.strictObject({ version: z.number().int().positive(), edits: z.array(V3Edit).max(2000) });
type PreviewDraft = z.infer<typeof PreviewDraft>;
const PreviewActionRequest = z.strictObject({ token: z.string().min(1), action: Action, draft: PreviewDraft.optional() });
const PreviewCheckRequest = z.strictObject({ token: z.string().min(1), messageId: z.string().min(1), draft: PreviewDraft.optional() });
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
  if (!adventure || !(await canStaffAdventure(deps.store, adventure, userId))) {
    return error(404, "not_found", "Not found.");
  }
  if (adventure.spec === null) {
    return error(409, "not_ready", "This adventure has no story to preview yet.");
  }
  const parsed = decodeStoredSpec(adventure.spec);
  if (!parsed.ok) {
    return error(409, "not_ready", parsed.issues.some(issue => issue.path === "schemaVersion")
      ? "This saved format cannot be previewed. Upgrade the adventure or use a supported format first."
      : "This adventure's story has errors to fix before it can be previewed.");
  }
  return { adventure, spec: parsed.spec } as const;
}

async function draftSpec(
  deps: V3PreviewDeps,
  access: { adventure: { id: string; specVersion: number }; spec: EngineSpec },
  draft: PreviewDraft | undefined,
): Promise<EngineSpec | ServiceResponse> {
  if (!draft || draft.edits.length === 0) return access.spec;
  if (draft.version !== access.adventure.specVersion) {
    return error(409, "preview_reset", "The saved adventure changed. Restart the preview to play the latest version.");
  }
  try {
    const edited = validateSpec(applyTeacherEdits(access.spec, draft.edits, (await deps.sources?.(access.adventure.id)) ?? []));
    if (edited.ok) return edited.spec;
  } catch {
    // Reported below with the same message as an invalid result.
  }
  return error(422, "draft_invalid", "Your latest edit has errors, so the preview is still playing the previous version. Fix it to keep previewing.");
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
  version: number,
  state: EngineState,
): string {
  return signPreviewState(
    state,
    { userId, adventureId, version },
    deps.stateSecret ?? deps.env?.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function verifyState(
  deps: V3PreviewDeps,
  userId: string,
  adventureId: string,
  version: number,
  token: string,
): EngineState | null {
  return verifyPreviewState(
    token,
    { userId, adventureId, version },
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
      token: signState(deps, userId, adventureId, access.adventure.specVersion, state),
      view: engine.project(access.spec, state),
      insight: previewInsight(access.spec, state, deps.now()),
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
  const state = verifyState(deps, userId, adventureId, access.adventure.specVersion, parsed.data.token);
  if (!state) return error(400, "preview_reset", RESET_MESSAGE);
  if (!limiterFor(deps)(`preview:${userId}`)) {
    return error(429, "rate_limited", "You're moving too quickly. Please wait a moment and try again.");
  }
  const spec = await draftSpec(deps, access, parsed.data.draft);
  if ("status" in spec) return spec;
  const llm = deps.llm({ organizationId: access.adventure.schoolId, userId });
  try {
    const result = await engine.step(
      { spec, state, action: parsed.data.action },
      {
        llm,
        now: deps.now(),
        rng: createRng(`preview:${adventureId}:${crypto.randomUUID()}`),
      },
    );
    return {
      status: 200,
      body: {
        token: signState(deps, userId, adventureId, access.adventure.specVersion, result.state),
        view: result.view,
        pendingCheckIds: pendingCheckIds(result.state),
        insight: previewInsight(spec, result.state, deps.now()),
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
  const state = verifyState(deps, userId, adventureId, access.adventure.specVersion, parsed.data.token);
  if (!state) return error(400, "preview_reset", RESET_MESSAGE);
  if (!limiterFor(deps)(`preview:${userId}`)) {
    return error(429, "rate_limited", "You're moving too quickly. Please wait a moment and try again.");
  }
  const spec = await draftSpec(deps, access, parsed.data.draft);
  if ("status" in spec) return spec;
  const llm = deps.llm({ organizationId: access.adventure.schoolId, userId });
  try {
    if (!pendingCheckIds(state).includes(parsed.data.messageId)) {
      return {
        status: 200,
        body: {
          token: parsed.data.token,
          view: engine.project(spec, state),
          pendingCheckIds: pendingCheckIds(state),
          insight: previewInsight(spec, state, deps.now()),
        },
      };
    }
    const result = await runPostTurnCheck(spec, state, parsed.data.messageId, { llm });
    const stepped = await engine.step(
      {
        spec,
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
        token: signState(deps, userId, adventureId, access.adventure.specVersion, stepped.state),
        view: stepped.view,
        pendingCheckIds: pendingCheckIds(stepped.state),
        insight: previewInsight(spec, stepped.state, deps.now()),
      },
    };
  } catch (cause) {
    return stepError(cause, "Failed to run v3 preview check");
  }
}
