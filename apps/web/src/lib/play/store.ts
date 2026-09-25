/**
 * Where an attempt's play state lives. The session engine is storage-agnostic;
 * this is the seam between it and the platform schema (P1/P7):
 *
 *  - deny-all `attempt_runtime` holds the complete `PlaySnapshot`;
 *  - client-readable `attempt_state` holds only public metadata, journal and position;
 *  - `message`, `stage_commitment` and `resolution` record what happened for resume and debrief;
 *  - stage deadlines and completion go through the P6/P8 RPCs.
 *
 * The runtime speaks spec slugs and relational foreign keys use UUIDs. Persisted rows carry stable
 * `spec_id` slugs, and a missing or ambiguous binding fails the write rather than silently dropping
 * authority metadata.
 */
import { PLAYER_ID } from "@adventure/generation/runtime";
import type { AssetManifest } from "@adventure/generation/assets";
import { validatePublishedSpec, type AdventureSpec } from "@adventure/generation/spec";
import type { MintedOption } from "@adventure/orchestration";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadManifest } from "@/lib/assets/supabase";

import { readCompiledStages } from "./layout";
import type { CompiledStage } from "@adventure/game-core";
import type { PlaySnapshot, SessionEvents } from "./session";
import type { PlayTimings } from "./timing";
import {
  getAssets,
  getStage,
  getStages,
  getVersion,
  setAssets,
  setStage,
  setStages,
  setVersion,
  type CachedStageRow,
} from "./version-cache";

export interface AttemptRecord {
  attemptId: string;
  studentId: string;
  adventureId: string;
  publishedVersion: number;
  status: "active" | "spectating" | "completed" | "abandoned";
  stageDeadlineAt: string | null;
  spec: AdventureSpec;
  snapshot: PlaySnapshot | null;
  runtimeRevision: number;
  /** Generated images for the pinned version, if generation has run (D4). */
  assets?: AssetManifest | null;
  compiledStages?: CompiledStage[];
}

export type PlayEvents = SessionEvents;

/** What `save` reports back: the deadline the store holds after recording the events. */
export interface SaveResult {
  stageDeadlineAt: string | null;
}

/** Another writer advanced the attempt first: this request's snapshot is stale and was not stored. */
export class RuntimeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConflictError";
  }
}

export class PlayConflictError extends RuntimeConflictError {
  constructor() {
    super("The attempt changed. Refresh and try again.");
    this.name = "PlayConflictError";
  }
}

export interface PlayStore {
  load(attemptId: string, userId: string, timings?: PlayTimings): Promise<AttemptRecord | null>;
  save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents, timings?: PlayTimings): Promise<SaveResult>;
  now(timings?: PlayTimings): Promise<Date>;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type StageRow = CachedStageRow;
type BinderRow = { id: string; spec_id: string | null; stage_id: string };

function timed<T>(timings: PlayTimings | undefined, name: string, operation: () => T | Promise<T>): Promise<T> {
  return timings ? timings.time(name, operation) : Promise.resolve(operation());
}

function stageIndexMap(spec: AdventureSpec, rows: StageRow[]): Map<number, StageRow> {
  const byIndex = new Map<number, StageRow>();
  const ids = new Set<string>();
  const expected = new Set(spec.stages.map((stage) => stage.id));
  for (const row of rows) {
    if (
      row.spec_id === null ||
      row.spec_id === "" ||
      !expected.has(row.spec_id) ||
      ids.has(row.spec_id) ||
      byIndex.has(row.index)
    ) {
      throw new Error("stage rows have missing, duplicate, or mismatched spec ids");
    }
    ids.add(row.spec_id);
    byIndex.set(row.index, row);
  }
  for (const stage of spec.stages) {
    const row = byIndex.get(stage.index);
    if (!row || row.spec_id !== stage.id) throw new Error("stage rows do not match the authored spec");
  }
  return byIndex;
}

function binderMap(
  rows: BinderRow[] | null,
  expected: readonly string[],
  stageUuid: string,
  kind: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const expectedSet = new Set(expected);
  for (const row of rows ?? []) {
    if (
      row.stage_id !== stageUuid ||
      row.spec_id === null ||
      row.spec_id === "" ||
      !expectedSet.has(row.spec_id) ||
      map.has(row.spec_id)
    ) {
      throw new Error(`${kind} rows have missing, duplicate, or mismatched spec ids`);
    }
    map.set(row.spec_id, row.id);
  }
  for (const specId of expected) {
    if (!map.has(specId)) throw new Error(`${kind} rows do not match the authored spec`);
  }
  return map;
}

export class SupabasePlayStore implements PlayStore {
  constructor(private readonly admin: SupabaseClient) {}

  async load(attemptId: string, userId: string, timings?: PlayTimings): Promise<AttemptRecord | null> {
    const [{ data: attempt, error: attemptError }, { data: runtime, error: runtimeError }] = await Promise.all([
      timed(timings, "load.attempt", () => this.admin
        .from("attempt")
        .select("id, adventure_id, published_version, student_id, status, ending_id, current_stage_id, stage_deadline_at")
        .eq("id", attemptId)
        .maybeSingle<{
          id: string;
          adventure_id: string;
          published_version: number;
          student_id: string;
          status: AttemptRecord["status"];
          ending_id: string | null;
          current_stage_id: string | null;
          stage_deadline_at: string | null;
        }>()),
      timed(timings, "load.runtime", () => this.admin
        .from("attempt_runtime")
        .select("stage_spec_id, revision, snapshot")
        .eq("attempt_id", attemptId)
        .maybeSingle<{ stage_spec_id: string; revision: number; snapshot: unknown }>()),
    ]);
    if (attemptError) throw new Error(`attempt: ${attemptError.message}`);
    if (!attempt || attempt.student_id !== userId) return null;
    // A failed read is not an absent runtime: treating it as one would start a
    // fresh session over saved state and then collide with it on save.
    if (runtimeError) throw new Error(`attempt_runtime: ${runtimeError.message}`);

    const cachedVersion = getVersion(attempt.adventure_id, attempt.published_version);
    const { data: version, error: versionError } = await timed(timings, "load.version", () => cachedVersion
      ? { data: { id: cachedVersion.specVersionId }, error: null }
      : this.admin
        .from("spec_version")
        .select("id, json, compiled_stages")
        .eq("adventure_id", attempt.adventure_id)
        .eq("version", attempt.published_version)
        .maybeSingle<{ id: string; json: unknown; compiled_stages: unknown }>());
    // Likewise for the pinned version: a read that failed is not a version that
    // is absent, and reporting it as one tells the student "no such attempt".
    if (versionError) throw new Error(`spec_version: ${versionError.message}`);
    if (!version) return null;
    let spec: AdventureSpec;
    let compiledStages: CompiledStage[];
    if (cachedVersion) {
      ({ spec, compiledStages } = await timed(timings, "load.validate", () => cachedVersion));
    } else {
      const uncachedVersion = version as { id: string; json: unknown; compiled_stages: unknown };
      const validated = await timed(timings, "load.validate", () => {
        const result = validatePublishedSpec(uncachedVersion.json);
        return result.ok ? { ...result, compiledStages: readCompiledStages(result.spec, uncachedVersion.compiled_stages) } : result;
      });
      if (!validated.ok) throw new Error(`published spec v${attempt.published_version} of ${attempt.adventure_id} is not a readable spec`);
      spec = validated.spec;
      compiledStages = validated.compiledStages;
      setVersion(attempt.adventure_id, attempt.published_version, {
        specVersionId: uncachedVersion.id,
        spec,
        compiledStages,
      });
    }
    const versionId = cachedVersion?.specVersionId ?? version.id;

    let currentStageIndex: number | null = null;
    if (attempt.status === "active") {
      if (attempt.current_stage_id === null) throw new Error("active attempt has no current stage");
      const cachedStage = getStage(versionId, attempt.current_stage_id);
      const { data: currentStage } = await timed(timings, "load.stage", () => cachedStage
        ? { data: cachedStage }
        : this.admin
          .from("stage")
          .select("id, index, spec_id, spec_version_id")
          .eq("id", attempt.current_stage_id)
          .maybeSingle<{ id: string; index: number; spec_id: string | null; spec_version_id: string }>());
      if (!cachedStage && currentStage) setStage(versionId, attempt.current_stage_id, currentStage);
      if (
        !currentStage ||
        currentStage.spec_version_id !== versionId ||
        currentStage.spec_id === null ||
        spec.stages[currentStage.index]?.id !== currentStage.spec_id
      ) {
        throw new Error("active attempt stage does not match the authored spec");
      }
      currentStageIndex = currentStage.index;
    } else if (attempt.status === "completed" && attempt.current_stage_id !== null) {
      throw new Error("completed attempt still has a current stage");
    }

    let snapshot: PlaySnapshot | null = null;
    let runtimeRevision = 0;
    if (runtime !== null) {
      const candidate = runtime.snapshot as Partial<PlaySnapshot> | null;
      const stageIndex = candidate?.stageIndex;
      if (
        candidate === null ||
        candidate.version !== 1 ||
        typeof stageIndex !== "number" ||
        !Number.isInteger(stageIndex) ||
        stageIndex < 0 ||
        stageIndex >= spec.stages.length ||
        candidate.world === undefined
      ) {
        throw new Error("stored play runtime snapshot is invalid");
      }
      const authoredStageId = spec.stages[stageIndex]?.id;
      if (runtime.stage_spec_id !== authoredStageId) throw new Error("stored play runtime stage does not match the spec");
      if (attempt.status === "active" && currentStageIndex !== stageIndex) {
        throw new Error("stored play runtime stage does not match the current attempt stage");
      }
      if (attempt.status === "completed") {
        if (candidate.status !== "completed" || attempt.ending_id === null || candidate.endingId !== attempt.ending_id) {
          throw new Error("stored completed play runtime does not match the attempt");
        }
      } else if (candidate.endingId !== null || candidate.status === "completed") {
        throw new Error("stored active play runtime is completed");
      }
      snapshot = candidate as PlaySnapshot;
      runtimeRevision = runtime.revision;
    } else if (attempt.status === "completed" || currentStageIndex !== 0) {
      throw new Error("attempt without runtime must still be at the opening stage");
    }
    const cachedAssets = getAssets(versionId);
    const assets = await timed(timings, "load.assets", async () => {
      if (cachedAssets !== undefined) return cachedAssets;
      const manifest = await loadManifest(this.admin, versionId, attempt.adventure_id, attempt.published_version);
      setAssets(versionId, manifest);
      return manifest;
    });

    return {
      attemptId,
      studentId: attempt.student_id,
      adventureId: attempt.adventure_id,
      publishedVersion: attempt.published_version,
      status: attempt.status,
      stageDeadlineAt: attempt.stage_deadline_at,
      spec,
      snapshot,
      runtimeRevision,
      assets,
      compiledStages,
    };
  }

  async save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents, timings?: PlayTimings): Promise<SaveResult> {
    const cachedVersion = getVersion(record.adventureId, record.publishedVersion);
    const { data: version } = await timed(timings, "save.version", () => cachedVersion
      ? { data: { id: cachedVersion.specVersionId } }
      : this.admin
        .from("spec_version")
        .select("id")
        .eq("adventure_id", record.adventureId)
        .eq("version", record.publishedVersion)
        .single<{ id: string }>());
    if (!version) throw new Error("spec_version: no pinned version");
    const cachedStages = getStages(version.id);
    const { data: stageRows } = cachedStages
      ? await timed(timings, "save.stages", () => ({ data: cachedStages }))
      : await timed(timings, "save.stages", () => this.admin
        .from("stage")
        .select("id, index, spec_id")
        .eq("spec_version_id", version.id)
        .returns<StageRow[]>());
    if (!cachedStages && stageRows) setStages(version.id, stageRows);
    const stages = stageIndexMap(record.spec, stageRows ?? []);
    const stageUuid = (index: number): string => {
      const row = stages.get(index);
      if (!row) throw new Error(`stage: no authored stage at index ${index}`);
      return row.id;
    };

    const touched = new Set<number>([
      ...events.utterances.map((u) => u.stageIndex),
      ...events.decisions.map((d) => d.stageIndex),
      ...(events.resolution ? [events.resolution.stageIndex] : []),
      ...(events.telemetry ? [events.telemetry.stageIndex] : []),
    ]);
    const binders = new Map<number, Promise<Binder>>();
    for (const index of touched) binders.set(index, this.binder(record.spec, index, stageUuid(index)));
    await timed(timings, "save.binders", () => Promise.all(binders.values()));
    const bind = (index: number) => binders.get(index)!;
    const base = Date.now();
    const messageRows = await Promise.all(events.utterances.map(async ({ line, heardByPlayer, stageIndex }, i) => {
      const b = await bind(stageIndex);
      const isPlayer = line.speakerId === PLAYER_ID;
      const spokenAt = snapshot.stageIndex === stageIndex ? snapshot.spokenAt[line.seq] : undefined;
      return {
        runtime_id: `${record.attemptId}:${stageIndex}:${line.seq}`,
        room_id: b.rooms.get(line.roomId) ?? null,
        author_type: isPlayer ? "player" : "agent",
        author_id: isPlayer ? record.studentId : b.agents.get(line.speakerId) ?? null,
        body: line.body,
        visibility: heardByPlayer ? "room" : "private",
        created_at: new Date((spokenAt ? new Date(spokenAt).getTime() : base) + i).toISOString(),
      };
    }));
    const messages = [...new Map(messageRows.map((row) => [row.runtime_id, row])).values()];
    const commitments = await Promise.all(events.decisions.map(async ({ decision, stageIndex }) => {
      const b = await bind(stageIndex);
      const agentId = decision.actorKind === "agent" ? b.agents.get(decision.actorId) ?? null : null;
      if (decision.actorKind === "agent" && !agentId) throw new Error(`agent: missing authored id ${decision.actorId}`);
      const authoredOptionId = decision.optionId ? b.options.get(decision.optionId) ?? null : null;
      return {
        stage_id: stageUuid(stageIndex),
        actor_kind: decision.actorKind,
        player_id: decision.actorKind === "player" ? record.studentId : null,
        agent_id: agentId,
        option_id: authoredOptionId,
        minted_spec_id: authoredOptionId === null && decision.optionId ? decision.optionId : null,
      };
    }));
    const persistedMintedOptions = (snapshot.mintedOptions ?? []).map((option: MintedOption) => {
      const branchTargetStageId = option.branchTarget.kind === "stage" ? option.branchTarget.stageId : null;
      const branchTargetIndex = branchTargetStageId === null
        ? null
        : record.spec.stages.findIndex((stage) => stage.id === branchTargetStageId);
      if (branchTargetIndex !== null && branchTargetIndex < 0) {
        throw new Error(`minted option branch target ${branchTargetStageId} is not in the authored spec`);
      }
      return {
        stage_id: stageUuid(snapshot.stageIndex),
        spec_id: option.id,
        label: option.label,
        preconditions: option.preconditions,
        branch_target: branchTargetIndex === null ? null : stageUuid(branchTargetIndex),
      };
    });
    const resolution = events.resolution ? (() => {
      const { record: r } = events.resolution;
      return { stage_id: stageUuid(events.resolution!.stageIndex), actions: r.actions, outcome: { ...r.outcome, rationale: r.rationale, privateNotes: r.privateNotes }, rolls: r.rolls };
    })() : null;
    const telemetry = events.telemetry ? { stage_id: stageUuid(events.telemetry.stageIndex), stage_index: events.telemetry.stageIndex, ended_by: events.telemetry.endedBy, duration_seconds: events.telemetry.durationSeconds, tokens: events.telemetry.tokens, messages: events.telemetry.messages, actions: events.telemetry.actions, evidence_found: events.telemetry.evidenceFound, agent_lines: events.telemetry.agentLines } : null;
    const openedStageId = events.openedStageIndex !== null && events.openedStageIndex !== record.snapshot?.stageIndex ? stageUuid(events.openedStageIndex) : null;
    const { data, error } = await timed(timings, "save.rpc", () => this.admin.rpc("save_play_turn", {
      p_attempt_id: record.attemptId,
      p_expected_revision: record.runtimeRevision,
      p_stage_spec_id: record.spec.stages[snapshot.stageIndex]!.id,
      p_snapshot: snapshot,
      p_messages: messages,
      p_commitments: commitments,
      p_resolution: resolution,
      p_telemetry: telemetry,
      p_opened_stage_id: openedStageId,
      p_ending_id: events.endingId,
      p_minted_options: persistedMintedOptions,
    }));
    if (error && (error.code === "PT409" || error.code === "40001" || /revision conflict/.test(error.message))) throw new PlayConflictError();
    if (error) throw new Error(`save_play_turn: ${error.message}`);
    if (data && typeof data === "object" && typeof (data as { conflict?: unknown }).conflict === "string") throw new PlayConflictError();
    const result = data as { runtimeRevision?: unknown; stageDeadlineAt?: unknown } | null;
    if (!result || typeof result.runtimeRevision !== "number" || (result.stageDeadlineAt !== null && typeof result.stageDeadlineAt !== "string")) throw new Error("save_play_turn: invalid response");
    record.runtimeRevision = result.runtimeRevision;
    return { stageDeadlineAt: result.stageDeadlineAt };
  }

  async now(timings?: PlayTimings): Promise<Date> {
    const { data } = await timed(timings, "now", () => this.admin.rpc("server_now"));
    return data ? new Date(data as string) : new Date();
  }

  private async binder(spec: AdventureSpec, stageIndex: number, stageUuid: string): Promise<Binder> {
    const stage = spec.stages[stageIndex];
    if (!stage) return emptyBinder();
    const [{ data: rooms }, { data: agents }, { data: options }] = await Promise.all([
      this.admin.from("room").select("id, spec_id, stage_id").eq("stage_id", stageUuid).returns<BinderRow[]>(),
      this.admin.from("agent").select("id, spec_id, stage_id").eq("stage_id", stageUuid).returns<BinderRow[]>(),
      this.admin.from("decision_option").select("id, spec_id, stage_id").eq("stage_id", stageUuid).returns<BinderRow[]>(),
    ]);
    return {
      rooms: binderMap(rooms, stage.rooms.map((room) => room.id), stageUuid, "room"),
      agents: binderMap(agents, stage.agents.map((agent) => agent.id), stageUuid, "agent"),
      options: binderMap(options, stage.decision.options.map((option) => option.id), stageUuid, "option"),
    };
  }
}

interface Binder {
  rooms: Map<string, string>;
  agents: Map<string, string>;
  options: Map<string, string>;
}

function emptyBinder(): Binder {
  return { rooms: new Map(), agents: new Map(), options: new Map() };
}

// ---------------------------------------------------------------------------
// In-memory, for the API tests and the no-database CI job
// ---------------------------------------------------------------------------

export class MemoryPlayStore implements PlayStore {
  readonly saved: { snapshot: PlaySnapshot; events: PlayEvents }[] = [];
  private readonly records = new Map<string, AttemptRecord>();
  clock = () => new Date("2026-09-22T12:00:00.000Z");

  constructor(records: readonly AttemptRecord[] = []) {
    for (const record of records) this.records.set(record.attemptId, structuredClone(record));
  }

  add(record: AttemptRecord): void {
    this.records.set(record.attemptId, structuredClone(record));
  }

  async load(attemptId: string, userId: string): Promise<AttemptRecord | null> {
    const record = this.records.get(attemptId);
    return record && record.studentId === userId ? structuredClone(record) : null;
  }

  async save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents): Promise<SaveResult> {
    const current = this.records.get(record.attemptId);
    if (!current || current.studentId !== record.studentId) throw new Error("attempt not found");
    if (current.runtimeRevision !== record.runtimeRevision) throw new PlayConflictError();
    current.snapshot = structuredClone(snapshot);
    current.runtimeRevision += 1;
    record.runtimeRevision = current.runtimeRevision;
    this.saved.push({ snapshot: structuredClone(snapshot), events: structuredClone(events) });
    if (events.endingId) {
      current.status = "completed";
      current.stageDeadlineAt = null;
    } else if (events.openedStageIndex !== null && events.openedStageIndex !== record.snapshot?.stageIndex) {
      current.stageDeadlineAt = null; // no timers in memory; a stage opens untimed
    }
    return { stageDeadlineAt: current.stageDeadlineAt };
  }

  async now(): Promise<Date> {
    return this.clock();
  }
}
