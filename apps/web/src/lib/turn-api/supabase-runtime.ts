import type { AdventureSpec } from "@adventure/generation/spec";
import { validateAdventureSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  commitRuntimeAttemptDecision,
  createRuntimeAttempt,
  expireRuntimeAttemptIfNeeded,
  postMessageToRuntimeAttempt,
  projectRuntimeState,
  restoreRuntimeAttempt,
  setRuntimeAttemptDeadline,
  snapshotRuntimeAttempt,
  type CommitDecisionResult,
  type PostMessageResult,
  type RuntimeAttempt,
  type RuntimeSnapshot,
} from "./runtime";
import type { PublicAttemptState } from "./contract";

const PLAYER_ACTOR_ID = "player";

export class AttemptNotFoundError extends Error {}
export class RuntimePersistenceError extends Error {}

type AttemptRow = {
  id: string;
  adventure_id: string;
  published_version: number;
  student_id: string;
  current_stage_id: string | null;
  status: string;
  ending_id: string | null;
  stage_deadline_at: string | null;
};

type StableRow = { id: string; spec_id: string | null };
type StageRow = StableRow & { index: number; spec_version_id: string };
type RuntimeRow = {
  stage_spec_id: string;
  revision: number;
  snapshot: RuntimeSnapshot;
};

type StableIds = {
  stageId: string;
  rooms: Map<string, string>;
  agents: Map<string, string>;
  options: Map<string, string>;
};

type LoadedAttempt = {
  attemptRow: AttemptRow;
  specVersionId: string;
  attempt: RuntimeAttempt;
  databaseRevision: number;
  initialized: boolean;
};

function errorMessage(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function persistenceError(operation: string, error: unknown): RuntimePersistenceError {
  return new RuntimePersistenceError(`${operation} failed: ${errorMessage(error)}`);
}

function parseDeadline(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new RuntimePersistenceError("attempt deadline is invalid");
  return parsed;
}

function uniqueStableMap(operation: string, rows: StableRow[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.id !== "string" || row.spec_id === null || row.spec_id === "") {
      throw new RuntimePersistenceError(`${operation} contains a missing spec_id`);
    }
    if (result.has(row.spec_id)) {
      throw new RuntimePersistenceError(`${operation} contains duplicate spec_id`);
    }
    result.set(row.spec_id, row.id);
  }
  return result;
}

function requireStableId(map: Map<string, string>, specId: string, operation: string): string {
  const id = map.get(specId);
  if (id === undefined) throw new RuntimePersistenceError(`${operation} is missing spec_id "${specId}"`);
  return id;
}

export class SupabaseRuntimeStore {
  constructor(
    private readonly user: SupabaseClient,
    private readonly admin: SupabaseClient,
  ) {}

  private async loadAttemptRow(attemptId: string): Promise<AttemptRow> {
    const authorization = await this.user
      .from("attempt")
      .select("id")
      .eq("id", attemptId)
      .maybeSingle();
    if (authorization.error) throw persistenceError("authorize attempt", authorization.error);
    if (authorization.data === null) throw new AttemptNotFoundError();

    const result = await this.admin
      .from("attempt")
      .select("id, adventure_id, published_version, student_id, current_stage_id, status, ending_id, stage_deadline_at")
      .eq("id", attemptId)
      .maybeSingle();
    if (result.error) throw persistenceError("load attempt", result.error);
    if (result.data === null) throw new RuntimePersistenceError("load attempt returned no row");
    return result.data as AttemptRow;
  }

  private async loadSpec(attempt: AttemptRow): Promise<{ id: string; spec: AdventureSpec }> {
    const result = await this.admin
      .from("spec_version")
      .select("id, json")
      .eq("adventure_id", attempt.adventure_id)
      .eq("version", attempt.published_version)
      .maybeSingle();
    if (result.error) throw persistenceError("load pinned spec", result.error);
    if (result.data === null) throw new RuntimePersistenceError("pinned spec was not found");
    const validation = validateAdventureSpec(result.data.json);
    if (!validation.ok) {
      throw new RuntimePersistenceError(`pinned spec is invalid (${validation.issues.length} issues)`);
    }
    return { id: result.data.id as string, spec: validation.spec };
  }

  private async loadStageById(stageId: string): Promise<StageRow> {
    const result = await this.admin
      .from("stage")
      .select("id, index, spec_id, spec_version_id")
      .eq("id", stageId)
      .maybeSingle();
    if (result.error) throw persistenceError("load stage", result.error);
    if (result.data === null) throw new RuntimePersistenceError("load stage returned no row");
    const row = result.data as StageRow;
    if (row.spec_id === null || row.spec_id === "") {
      throw new RuntimePersistenceError("load stage returned a missing spec_id");
    }
    return row;
  }

  private async loadStableIds(specVersionId: string, authoredStageId: string): Promise<StableIds> {
    const stageResult = await this.admin
      .from("stage")
      .select("id, spec_id")
      .eq("spec_version_id", specVersionId)
      .eq("spec_id", authoredStageId)
      .maybeSingle();
    if (stageResult.error) throw persistenceError("load stable stage id", stageResult.error);
    if (stageResult.data === null) throw new RuntimePersistenceError("load stable stage id returned no row");
    const stageRow = stageResult.data as StableRow;
    if (stageRow.spec_id === null || stageRow.spec_id === "") {
      throw new RuntimePersistenceError("load stable stage id returned a missing spec_id");
    }

    const roomsResult = await this.admin
      .from("room")
      .select("id, spec_id")
      .eq("stage_id", stageRow.id);
    if (roomsResult.error) throw persistenceError("load stable room ids", roomsResult.error);
    const agentsResult = await this.admin
      .from("agent")
      .select("id, spec_id")
      .eq("stage_id", stageRow.id);
    if (agentsResult.error) throw persistenceError("load stable agent ids", agentsResult.error);
    const optionsResult = await this.admin
      .from("decision_option")
      .select("id, spec_id")
      .eq("stage_id", stageRow.id);
    if (optionsResult.error) throw persistenceError("load stable option ids", optionsResult.error);

    return {
      stageId: stageRow.id,
      rooms: uniqueStableMap("stable room ids", (roomsResult.data ?? []) as StableRow[]),
      agents: uniqueStableMap("stable agent ids", (agentsResult.data ?? []) as StableRow[]),
      options: uniqueStableMap("stable option ids", (optionsResult.data ?? []) as StableRow[]),
    };
  }

  private async saveRuntime(context: LoadedAttempt): Promise<void> {
    const result = await this.admin.rpc("save_attempt_runtime", {
      p_attempt_id: context.attemptRow.id,
      p_expected_revision: context.databaseRevision,
      p_stage_spec_id: context.attempt.bundle.stageId,
      p_snapshot: snapshotRuntimeAttempt(context.attempt),
    });
    if (result.error) throw persistenceError("save attempt runtime", result.error);
    if (typeof result.data !== "number") {
      throw new RuntimePersistenceError("save attempt runtime returned a non-number revision");
    }
    context.databaseRevision = result.data;
  }

  private async savePublicAttemptState(
    context: LoadedAttempt,
    state: PublicAttemptState,
  ): Promise<void> {
    const result = await this.admin.from("attempt_state").upsert(
      {
        attempt_id: context.attemptRow.id,
        journal: state.journal,
        player_pos: state.playerPos,
        world_state: state,
      },
      { onConflict: "attempt_id" },
    );
    if (result.error) throw persistenceError("save public attempt state", result.error);
  }

  private publicState(context: LoadedAttempt): PublicAttemptState {
    const state = projectRuntimeState(context.attemptRow.id, context.attempt);
    return {
      ...state,
      adventureId: context.attemptRow.adventure_id,
      publishedVersion: context.attemptRow.published_version,
    };
  }

  private async loadContext(attemptId: string): Promise<LoadedAttempt> {
    const attemptRow = await this.loadAttemptRow(attemptId);
    const pinned = await this.loadSpec(attemptRow);
    const runtimeResult = await this.admin
      .from("attempt_runtime")
      .select("stage_spec_id, revision, snapshot")
      .eq("attempt_id", attemptId)
      .maybeSingle();
    if (runtimeResult.error) throw persistenceError("load attempt runtime", runtimeResult.error);

    if (runtimeResult.data !== null) {
      const runtime = runtimeResult.data as RuntimeRow;
      const snapshot = runtime.snapshot as RuntimeSnapshot;
      let attempt: RuntimeAttempt;
      try {
        attempt = restoreRuntimeAttempt(pinned.spec, snapshot);
      } catch (error) {
        throw persistenceError("restore attempt runtime", error);
      }
      if (runtime.stage_spec_id !== pinned.spec.stages[attempt.stageIndex]?.id) {
        throw new RuntimePersistenceError("attempt runtime stage does not match its snapshot");
      }
      if (attemptRow.status === "completed") {
        if (attemptRow.ending_id === null || attempt.endingId !== attemptRow.ending_id) {
          throw new RuntimePersistenceError("completed attempt ending does not match its runtime");
        }
      } else if (attempt.endingId !== null) {
        throw new RuntimePersistenceError("active attempt contains a completed runtime");
      }
      if (attemptRow.status === "active") {
        if (attemptRow.current_stage_id === null) {
          throw new RuntimePersistenceError("active attempt has no current stage");
        }
        const currentStage = await this.loadStageById(attemptRow.current_stage_id);
        if (
          currentStage.spec_version_id !== pinned.id ||
          currentStage.spec_id !== pinned.spec.stages[attempt.stageIndex]?.id
        ) {
          throw new RuntimePersistenceError("active attempt stage does not match its runtime");
        }
      }
      return {
        attemptRow,
        specVersionId: pinned.id,
        attempt,
        databaseRevision: runtime.revision,
        initialized: false,
      };
    }

    if (attemptRow.status === "completed") {
      throw new RuntimePersistenceError("completed attempt has no runtime snapshot");
    }
    if (attemptRow.current_stage_id === null) {
      throw new RuntimePersistenceError("attempt has no current stage");
    }
    const currentStage = await this.loadStageById(attemptRow.current_stage_id);
    const stageIndex = currentStage.index;
    if (
      currentStage.spec_version_id !== pinned.id ||
      pinned.spec.stages[stageIndex]?.id !== currentStage.spec_id
    ) {
      throw new RuntimePersistenceError("attempt stage does not match pinned spec");
    }
    const attempt = createRuntimeAttempt(
      pinned.spec,
      stageIndex,
      Date.now(),
      parseDeadline(attemptRow.stage_deadline_at),
    );
    const context: LoadedAttempt = {
      attemptRow,
      specVersionId: pinned.id,
      attempt,
      databaseRevision: 0,
      initialized: true,
    };
    await this.saveRuntime(context);
    return context;
  }

  private async persistMessages(
    context: LoadedAttempt,
    messages: PublicAttemptState["transcript"],
  ): Promise<void> {
    const ids = await this.loadStableIds(context.specVersionId, context.attempt.bundle.stageId);
    const rows = messages.map((message) => ({
      attempt_id: context.attemptRow.id,
      runtime_id: message.id,
      room_id: message.roomId === null ? null : requireStableId(ids.rooms, message.roomId, "message room"),
      author_type: message.authorType,
      author_id:
        message.authorType === "player"
          ? context.attemptRow.student_id
          : message.authorType === "agent"
            ? requireStableId(ids.agents, message.authorId ?? "", "message agent")
            : null,
      body: message.body,
      created_at: message.createdAt,
      visibility: "room",
    }));
    if (rows.length === 0) return;
    const result = await this.admin
      .from("message")
      .upsert(rows, { onConflict: "attempt_id,runtime_id" });
    if (result.error) throw persistenceError("save runtime messages", result.error);
  }

  private async persistResolution(
    context: LoadedAttempt,
    previousResolutionCount: number,
    previousStageSpecId: string,
  ): Promise<void> {
    if (context.attempt.resolutions.length !== previousResolutionCount + 1) {
      throw new RuntimePersistenceError("runtime decision did not append exactly one resolution");
    }
    const record = context.attempt.resolutions[previousResolutionCount];
    if (record === undefined || record.stageId !== previousStageSpecId) {
      throw new RuntimePersistenceError("runtime resolution stage does not match the active stage");
    }
    const ids = await this.loadStableIds(context.specVersionId, previousStageSpecId);
    const commitmentActions = new Map<string, (typeof record.actions)[number]>();
    for (const action of record.actions) {
      if (action.action.type === "commit_decision" || action.action.type === "pass") {
        commitmentActions.set(action.actorId, action);
      }
    }
    const commitments = [...commitmentActions.values()].map((entry) => {
      const isPlayer = entry.actorId === PLAYER_ACTOR_ID;
      const agentId = isPlayer ? null : requireStableId(ids.agents, entry.actorId, "commitment agent");
      const optionId =
        entry.action.type === "commit_decision"
          ? requireStableId(ids.options, entry.action.optionId, "commitment option")
          : null;
      return {
        attempt_id: context.attemptRow.id,
        stage_id: ids.stageId,
        actor_kind: entry.actorKind,
        player_id: isPlayer ? context.attemptRow.student_id : null,
        agent_id: agentId,
        option_id: optionId,
      };
    });
    if (commitments.length > 0) {
      const result = await this.admin.from("stage_commitment").insert(commitments);
      if (result.error && result.error.code !== "23505") {
        throw persistenceError("save stage commitments", result.error);
      }
    }

    const resolutionResult = await this.admin.from("resolution").upsert(
      {
        attempt_id: context.attemptRow.id,
        stage_id: ids.stageId,
        actions: record.actions,
        rolls: record.rolls,
        outcome: {
          ...record.outcome,
          privateNotes: record.privateNotes,
          rationale: record.rationale,
        },
      },
      { onConflict: "attempt_id,stage_id" },
    );
    if (resolutionResult.error) throw persistenceError("save resolution", resolutionResult.error);

    if (record.outcome.next.kind === "stage") {
      const nextIds = await this.loadStableIds(context.specVersionId, record.outcome.next.stageId);
      const deadlineResult = await this.admin.rpc("start_stage_deadline", {
        p_attempt_id: context.attemptRow.id,
        p_stage_id: nextIds.stageId,
      });
      if (deadlineResult.error) throw persistenceError("start stage deadline", deadlineResult.error);
      const deadline = deadlineResult.data === null ? null : Date.parse(String(deadlineResult.data));
      if (deadlineResult.data !== null && Number.isNaN(deadline)) {
        throw new RuntimePersistenceError("start stage deadline returned an invalid timestamp");
      }
      setRuntimeAttemptDeadline(context.attempt, deadline);
    } else if (record.outcome.next.kind === "ending") {
      const result = await this.admin.rpc("complete_attempt", {
        p_attempt_id: context.attemptRow.id,
        p_ending_id: record.outcome.next.endingId,
      });
      if (result.error) throw persistenceError("complete attempt", result.error);
      setRuntimeAttemptDeadline(context.attempt, null);
    } else {
      throw new RuntimePersistenceError("resolution returned an unsupported continue target");
    }
  }

  private async savePublicAndRuntime(context: LoadedAttempt): Promise<PublicAttemptState> {
    const state = this.publicState(context);
    await this.savePublicAttemptState(context, state);
    await this.saveRuntime(context);
    context.initialized = false;
    return state;
  }

  async getState(attemptId: string): Promise<PublicAttemptState> {
    const context = await this.loadContext(attemptId);
    const previousResolutionCount = context.attempt.resolutions.length;
    const previousStageSpecId = context.attempt.bundle.stageId;
    if (expireRuntimeAttemptIfNeeded(attemptId, context.attempt)) {
      await this.persistResolution(context, previousResolutionCount, previousStageSpecId);
      return this.savePublicAndRuntime(context);
    }
    const state = this.publicState(context);
    if (context.initialized) {
      await this.savePublicAttemptState(context, state);
      context.initialized = false;
    }
    return state;
  }

  async postMessage(
    attemptId: string,
    roomId: string,
    body: string,
  ): Promise<PostMessageResult> {
    const context = await this.loadContext(attemptId);
    const result = await postMessageToRuntimeAttempt(attemptId, context.attempt, roomId, body);
    if (!result.ok) return result;
    await this.persistMessages(context, result.newMessages);
    const state = await this.savePublicAndRuntime(context);
    return { ...result, state };
  }

  async commitDecision(
    attemptId: string,
    optionId: string,
  ): Promise<CommitDecisionResult | null> {
    const context = await this.loadContext(attemptId);
    const previousResolutionCount = context.attempt.resolutions.length;
    const previousStageSpecId = context.attempt.bundle.stageId;
    const result = await commitRuntimeAttemptDecision(attemptId, context.attempt, optionId);
    if (result === null) return null;
    await this.persistResolution(context, previousResolutionCount, previousStageSpecId);
    const state = await this.savePublicAndRuntime(context);
    return { ...result, state };
  }
}
