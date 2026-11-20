import { EngineError, engine, pendingCheckIds, previewInsight, runPostTurnCheck, type EngineSpec, type EngineState } from "@adventure/engine";
import { Action } from "@adventure/play-contract";
import { createRng, type LlmClient } from "@adventure/orchestration";
import { z } from "zod";
import { decodeStoredSpec, validateSpec } from "@adventure/spec-v3";

import { applyTeacherEdits } from "@/lib/v3/edit/apply";
import { V3Edit, type CapturedSource } from "@/lib/v3/edit/commands";
import { mediaCandidateIds } from "@/lib/v3/edit/service";
import { resolveMediaCandidates, type MediaRepository } from "@/lib/v3/media/repository";

import { canStaffAdventure } from "./access";
import type { PreviewLock } from "./preview-client";
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
  /** Generated images a draft selected but has not saved yet. */
  media?: MediaRepository;
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

type Played = { spec: EngineSpec; locked: PreviewLock[] };
type Entity = { kind: PreviewLock["kind"]; id: string };
const GROUPS = { characters: "character", documents: "document", stages: "stage" } as const;

function entityAt(spec: EngineSpec, path: readonly (string | number)[]): Entity | null {
  const [group, index] = path;
  const kind = GROUPS[group as keyof typeof GROUPS];
  if (!kind || typeof index !== "number") return null;
  const id = (spec[group as keyof typeof GROUPS] as { id: string }[])[index]?.id;
  return id ? { kind, id } : null;
}

function editEntity(spec: EngineSpec, edit: V3Edit): Entity | null {
  if (edit.type === "set" || edit.type === "insert" || edit.type === "remove" || edit.type === "move") return entityAt(spec, edit.path);
  if (edit.type === "convertDocument" || edit.type === "replaceExcerpt") return { kind: "document", id: edit.documentId };
  return null;
}

const issuePath = (path: string) => path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
const sameEntity = (a: Entity, b: Entity) => a.kind === b.kind && a.id === b.id;

/**
 * The spec the preview plays: the saved version plus the teacher's unsaved edits. When edits leave
 * a character, document or stage invalid, that item's edits are left out and it is locked until fixed.
 */
async function draftSpec(
  deps: V3PreviewDeps,
  access: { adventure: { id: string; specVersion: number }; spec: EngineSpec },
  draft: PreviewDraft | undefined,
): Promise<Played | ServiceResponse> {
  if (!draft || draft.edits.length === 0) return { spec: access.spec, locked: [] };
  if (draft.version !== access.adventure.specVersion) {
    return error(409, "preview_reset", "The saved adventure changed. Restart the preview to play the latest version.");
  }
  const invalid = () => error(422, "draft_invalid", "Your latest edit has errors the preview can't play. Fix it in the edit panel to keep previewing.");
  let attempt: (edits: V3Edit[]) => ReturnType<typeof validateSpec> | null;
  try {
    const sources = (await deps.sources?.(access.adventure.id)) ?? [];
    const ids = mediaCandidateIds(draft.edits);
    const media = { candidates: ids.length && deps.media ? await resolveMediaCandidates(deps.media, access.adventure.id, ids) : {} };
    attempt = (edits) => {
      try {
        return validateSpec(applyTeacherEdits(access.spec, edits, sources, media));
      } catch (cause) {
        return cause instanceof z.ZodError
          ? { ok: false as const, issues: cause.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }
          : null;
      }
    };
  } catch {
    return invalid();
  }
  const full = attempt(draft.edits);
  if (!full) return invalid();
  if (full.ok) return { spec: full.spec, locked: [] };
  const locked: PreviewLock[] = [];
  for (const issue of full.issues) {
    const entity = entityAt(access.spec, issuePath(issue.path));
    if (!entity) return invalid();
    if (!locked.some((lock) => sameEntity(lock, entity))) locked.push({ ...entity, message: issue.message });
  }
  const kept = draft.edits.filter((edit) => {
    const entity = editEntity(access.spec, edit);
    return !entity || !locked.some((lock) => sameEntity(lock, entity));
  });
  const partial = attempt(kept);
  return partial?.ok ? { spec: partial.spec, locked } : invalid();
}

function lockedBy(played: Played, state: EngineState, action: Action): ServiceResponse | null {
  const stage = played.spec.stages[state.stageIndex]?.id;
  const lock = played.locked.find((item) =>
    (item.kind === "stage" && item.id === stage) ||
    (item.kind === "character" && "characterId" in action && action.characterId === item.id) ||
    (item.kind === "document" && "documentId" in action && action.documentId === item.id));
  if (!lock) return null;
  const named = (played.spec[`${lock.kind}s`] as { id: string; name?: string; title?: string }[]).find((item) => item.id === lock.id);
  const label = named?.name ?? named?.title ?? "This item";
  const response = error(423, "draft_locked", `${label} has an edit with errors, so it is paused in the preview. Fix it in the edit panel to keep playing it.`);
  return { ...response, body: { ...(response.body as object), locked: played.locked } };
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
  const played = await draftSpec(deps, access, parsed.data.draft);
  if ("status" in played) return played;
  const blocked = lockedBy(played, state, parsed.data.action);
  if (blocked) return blocked;
  const { spec, locked } = played;
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
        locked,
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
  const played = await draftSpec(deps, access, parsed.data.draft);
  if ("status" in played) return played;
  const { spec, locked } = played;
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
        locked,
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
        locked,
      },
    };
  } catch (cause) {
    return stepError(cause, "Failed to run v3 preview check");
  }
}
