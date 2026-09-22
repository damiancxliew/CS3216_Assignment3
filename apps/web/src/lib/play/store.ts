/**
 * Where an attempt's play state lives. The session engine is storage-agnostic;
 * this is the seam between it and the platform schema (P1/P7):
 *
 *  - `attempt_state.world_state` holds the `PlaySnapshot` verbatim;
 *  - `message`, `stage_commitment` and `resolution` are written as a record of
 *    what happened, for resume, the teacher's roster and the debrief;
 *  - stage deadlines and completion go through the P6/P8 RPCs, which are the
 *    only things allowed to move them.
 *
 * The runtime speaks spec slugs and the tables speak uuids. Rows carry no slug,
 * so the binding is by stage index (unique per version) and by name within the
 * stage. A name that does not bind leaves the foreign key null rather than
 * failing the turn.
 */
import { PLAYER_ID } from "@adventure/generation/runtime";
import { validateAdventureSpec, type AdventureSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlaySnapshot, SessionEvents } from "./session";

export interface AttemptRecord {
  attemptId: string;
  studentId: string;
  adventureId: string;
  publishedVersion: number;
  status: "active" | "spectating" | "completed" | "abandoned";
  stageDeadlineAt: string | null;
  spec: AdventureSpec;
  snapshot: PlaySnapshot | null;
}

export type PlayEvents = SessionEvents;

/** What `save` reports back: the deadline the store holds after recording the events. */
export interface SaveResult {
  stageDeadlineAt: string | null;
}

export class PlayConflictError extends Error {
  constructor() {
    super("The attempt changed. Refresh and try again.");
    this.name = "PlayConflictError";
  }
}

export interface PlayStore {
  load(attemptId: string, userId: string): Promise<AttemptRecord | null>;
  save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents): Promise<SaveResult>;
  now(): Promise<Date>;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type StageRow = { id: string; index: number };
type NamedRow = { id: string; name?: string; label?: string; stage_id: string };

export class SupabasePlayStore implements PlayStore {
  constructor(private readonly admin: SupabaseClient) {}

  async load(attemptId: string, userId: string): Promise<AttemptRecord | null> {
    const { data: attempt, error: attemptError } = await this.admin
      .from("attempt")
      .select("id, adventure_id, published_version, student_id, status, stage_deadline_at")
      .eq("id", attemptId)
      .maybeSingle<{ id: string; adventure_id: string; published_version: number; student_id: string; status: AttemptRecord["status"]; stage_deadline_at: string | null }>();
    if (attemptError) throw new Error(`attempt: ${attemptError.message}`);
    // The player of an attempt is its student; a teacher watches through the console, not the Turn API.
    if (!attempt || attempt.student_id !== userId) return null;

    const [{ data: version, error: versionError }, { data: state, error: stateError }] = await Promise.all([
      this.admin
        .from("spec_version")
        .select("id, json")
        .eq("adventure_id", attempt.adventure_id)
        .eq("version", attempt.published_version)
        .single<{ id: string; json: unknown }>(),
      this.admin.from("attempt_state").select("world_state").eq("attempt_id", attemptId).maybeSingle<{ world_state: unknown }>(),
    ]);
    if (versionError) throw new Error(`spec_version: ${versionError.message}`);
    if (stateError) throw new Error(`attempt_state: ${stateError.message}`);
    if (!version) return null;
    const validated = validateAdventureSpec(version.json);
    if (!validated.ok) throw new Error(`published spec v${attempt.published_version} of ${attempt.adventure_id} no longer validates`);

    const raw = state?.world_state as Partial<PlaySnapshot> | null | undefined;
    const snapshot = raw && raw.version === 1 && raw.world ? (raw as PlaySnapshot) : null;

    return {
      attemptId,
      studentId: attempt.student_id,
      adventureId: attempt.adventure_id,
      publishedVersion: attempt.published_version,
      status: attempt.status,
      stageDeadlineAt: attempt.stage_deadline_at,
      spec: validated.spec,
      snapshot,
    };
  }

  async save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents): Promise<SaveResult> {
    const { data: version, error: versionError } = await this.admin
      .from("spec_version")
      .select("id")
      .eq("adventure_id", record.adventureId)
      .eq("version", record.publishedVersion)
      .single<{ id: string }>();
    if (versionError) throw new Error(`spec_version: ${versionError.message}`);
    if (!version) throw new Error(`spec_version: no pinned version for ${record.adventureId} v${record.publishedVersion}`);
    const { data: stageRows, error: stageError } = await this.admin
      .from("stage")
      .select("id, index")
      .eq("spec_version_id", version.id)
      .returns<StageRow[]>();
    if (stageError) throw new Error(`stage: ${stageError.message}`);
    const stageUuid = (index: number) => stageRows?.find((s) => s.index === index)?.id ?? null;

    const touched = new Set<number>([
      ...events.utterances.map((u) => u.stageIndex),
      ...events.decisions.map((d) => d.stageIndex),
    ]);
    const binders = new Map<number, Binder>();
    await Promise.all([...touched].map(async (index) => {
      const id = stageUuid(index);
      if (!id) throw new Error(`stage: no stage at index ${index} in pinned version`);
      binders.set(index, await this.binder(record.spec, index, id));
    }));
    const bind = (index: number) => {
      const binder = binders.get(index);
      if (!binder) throw new Error(`stage: no stage at index ${index} in pinned version`);
      return binder;
    };

    // One batch insert would give every row the same `created_at`; the transcript is ordered by
    // it, so each line gets the time it was spoken (or a millisecond per seq when unknown).
    const base = Date.now();
    const messages = await Promise.all(
      events.utterances.map(async ({ line, heardByPlayer, stageIndex }, i) => {
        const b = bind(stageIndex);
        const isPlayer = line.speakerId === PLAYER_ID;
        const roomId = line.roomId === "__outdoors__" || line.roomId === "__doorway__" ? null : b.rooms.get(line.roomId);
        if (!isPlayer && !b.agents.has(line.speakerId)) throw new Error(`message: no agent binding for ${line.speakerId}`);
        if (line.roomId !== "__outdoors__" && line.roomId !== "__doorway__" && !roomId) throw new Error(`message: no room binding for ${line.roomId}`);
        const spokenAt = snapshot.stageIndex === stageIndex ? snapshot.spokenAt[line.seq] : undefined;
        return {
          room_id: roomId ?? null,
          author_type: isPlayer ? "player" : "agent",
          author_id: isPlayer ? record.studentId : b.agents.get(line.speakerId)!,
          body: line.body,
          visibility: heardByPlayer ? "room" : "private",
          created_at: new Date((spokenAt ? new Date(spokenAt).getTime() : base) + i).toISOString(),
        };
      }),
    );

    // The uniqueness index is an expression (`coalesce(player_id, agent_id)`), which upsert cannot
    // target, so a re-recorded commitment is tolerated as a duplicate-key error instead.
    const decisions = await Promise.all(
      events.decisions.map(async ({ decision, stageIndex }) => {
        const stageId = stageUuid(stageIndex);
        if (!stageId) throw new Error(`stage: no stage at index ${stageIndex} in pinned version`);
        const b = bind(stageIndex);
        const agentId = decision.actorKind === "agent" ? b.agents.get(decision.actorId) : null;
        if (decision.actorKind === "agent" && !agentId) throw new Error(`stage_commitment: no agent binding for ${decision.actorId}`);
        const optionId = decision.optionId ? b.options.get(decision.optionId) : null;
        if (decision.optionId && !optionId) throw new Error(`stage_commitment: no option binding for ${decision.optionId}`);
        return {
          stage_id: stageId,
          actor_kind: decision.actorKind,
          player_id: decision.actorKind === "player" ? record.studentId : null,
          agent_id: agentId,
          option_id: optionId,
        };
      }),
    );

    let resolution: Record<string, unknown> | null = null;
    if (events.resolution) {
      const stageId = stageUuid(events.resolution.stageIndex);
      if (!stageId) throw new Error(`resolution: no stage at index ${events.resolution.stageIndex} in pinned version`);
      const { record: r } = events.resolution;
      resolution = {
        stage_id: stageId,
        actions: {},
        outcome: { ...r.outcome, rationale: r.rationale, privateNotes: r.privateNotes },
        rolls: r.rolls,
      };
    }

    let openedStageId: string | null = null;
    if (events.openedStageIndex !== null && events.openedStageIndex !== record.snapshot?.stageIndex) {
      openedStageId = stageUuid(events.openedStageIndex);
      if (!openedStageId) throw new Error(`stage: no stage at index ${events.openedStageIndex} in pinned version`);
    }

    const { data, error } = await this.admin.rpc("save_play_state", {
      p_attempt_id: record.attemptId,
      p_student_id: record.studentId,
      p_expected_revision: record.snapshot?.revision ?? -1,
      p_snapshot: snapshot,
      p_messages: messages,
      p_decisions: decisions,
      p_resolution: resolution,
      p_opened_stage_id: openedStageId,
      p_ending_id: events.endingId,
    });
    if (error?.code === "40001") throw new PlayConflictError();
    if (error) throw new Error(`save_play_state: ${error.message}`);
    return { stageDeadlineAt: (data as string | null) ?? null };
  }

  async now(): Promise<Date> {
    const { data } = await this.admin.rpc("server_now");
    return data ? new Date(data as string) : new Date();
  }

  private async binder(spec: AdventureSpec, stageIndex: number, stageUuid: string): Promise<Binder> {
    const stage = spec.stages[stageIndex];
    if (!stage) throw new Error(`stage: no spec stage at index ${stageIndex}`);
    const [{ data: rooms, error: roomsError }, { data: agents, error: agentsError }, { data: options, error: optionsError }] = await Promise.all([
      this.admin.from("room").select("id, name, stage_id").eq("stage_id", stageUuid).returns<NamedRow[]>(),
      this.admin.from("agent").select("id, name, stage_id").eq("stage_id", stageUuid).returns<NamedRow[]>(),
      this.admin.from("decision_option").select("id, label, stage_id").eq("stage_id", stageUuid).returns<NamedRow[]>(),
    ]);
    if (roomsError) throw new Error(`room: ${roomsError.message}`);
    if (agentsError) throw new Error(`agent: ${agentsError.message}`);
    if (optionsError) throw new Error(`decision_option: ${optionsError.message}`);
    const byName = (rows: NamedRow[] | null, key: "name" | "label") => new Map((rows ?? []).map((r) => [r[key] ?? "", r.id]));
    const roomRows = byName(rooms, "name");
    const agentRows = byName(agents, "name");
    const optionRows = byName(options, "label");
    const stakeholderName = (stakeholderId: string) => spec.stakeholders.find((s) => s.id === stakeholderId)?.name ?? "";
    return {
      rooms: new Map(stage.rooms.map((r) => [r.id, roomRows.get(r.name) ?? null]).filter((e): e is [string, string] => e[1] !== null)),
      agents: new Map(stage.agents.map((a) => [a.id, agentRows.get(stakeholderName(a.stakeholderId)) ?? null]).filter((e): e is [string, string] => e[1] !== null)),
      options: new Map(stage.decision.options.map((o) => [o.id, optionRows.get(o.label) ?? null]).filter((e): e is [string, string] => e[1] !== null)),
    };
  }
}

interface Binder {
  rooms: Map<string, string>;
  agents: Map<string, string>;
  options: Map<string, string>;
}

// ---------------------------------------------------------------------------
// In-memory, for the API tests and the no-database CI job
// ---------------------------------------------------------------------------

export class MemoryPlayStore implements PlayStore {
  readonly saved: { snapshot: PlaySnapshot; events: PlayEvents }[] = [];
  private readonly records = new Map<string, AttemptRecord>();
  clock = () => new Date("2026-09-22T12:00:00.000Z");

  constructor(records: readonly AttemptRecord[] = []) {
    for (const record of records) this.records.set(record.attemptId, record);
  }

  add(record: AttemptRecord): void {
    this.records.set(record.attemptId, record);
  }

  async load(attemptId: string, userId: string): Promise<AttemptRecord | null> {
    const record = this.records.get(attemptId);
    return record && record.studentId === userId ? structuredClone(record) : null;
  }

  async save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents): Promise<SaveResult> {
    const current = this.records.get(record.attemptId);
    if (!current || current.studentId !== record.studentId) throw new Error("attempt not found");
    const currentRevision = current.snapshot?.revision ?? -1;
    if (currentRevision !== (record.snapshot?.revision ?? -1) || snapshot.revision <= currentRevision) throw new PlayConflictError();
    this.saved.push({ snapshot: structuredClone(snapshot), events: structuredClone(events) });
    current.snapshot = structuredClone(snapshot);
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
