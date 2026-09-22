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
import type { AssetManifest } from "@adventure/generation/assets";
import { validateAdventureSpec, type AdventureSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadManifest } from "@/lib/assets/supabase";

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
  /** Generated images for the pinned version, if generation has run (D4). */
  assets?: AssetManifest | null;
}

export type PlayEvents = SessionEvents;

/** What `save` reports back: the deadline the store holds after recording the events. */
export interface SaveResult {
  stageDeadlineAt: string | null;
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
    const { data: attempt } = await this.admin
      .from("attempt")
      .select("id, adventure_id, published_version, student_id, status, stage_deadline_at")
      .eq("id", attemptId)
      .maybeSingle<{ id: string; adventure_id: string; published_version: number; student_id: string; status: AttemptRecord["status"]; stage_deadline_at: string | null }>();
    // The player of an attempt is its student; a teacher watches through the console, not the Turn API.
    if (!attempt || attempt.student_id !== userId) return null;

    const [{ data: version }, { data: state }] = await Promise.all([
      this.admin
        .from("spec_version")
        .select("id, json")
        .eq("adventure_id", attempt.adventure_id)
        .eq("version", attempt.published_version)
        .single<{ id: string; json: unknown }>(),
      this.admin.from("attempt_state").select("world_state").eq("attempt_id", attemptId).maybeSingle<{ world_state: unknown }>(),
    ]);
    if (!version) return null;
    const validated = validateAdventureSpec(version.json);
    if (!validated.ok) throw new Error(`published spec v${attempt.published_version} of ${attempt.adventure_id} no longer validates`);

    const raw = state?.world_state as Partial<PlaySnapshot> | null | undefined;
    const snapshot = raw && raw.version === 1 && raw.world ? (raw as PlaySnapshot) : null;
    const assets = await loadManifest(this.admin, version.id, attempt.adventure_id, attempt.published_version);

    return {
      attemptId,
      studentId: attempt.student_id,
      adventureId: attempt.adventure_id,
      publishedVersion: attempt.published_version,
      status: attempt.status,
      stageDeadlineAt: attempt.stage_deadline_at,
      spec: validated.spec,
      snapshot,
      assets,
    };
  }

  async save(record: AttemptRecord, snapshot: PlaySnapshot, events: PlayEvents): Promise<SaveResult> {
    const { data: version } = await this.admin
      .from("spec_version")
      .select("id")
      .eq("adventure_id", record.adventureId)
      .eq("version", record.publishedVersion)
      .single<{ id: string }>();
    const { data: stageRows } = version
      ? await this.admin.from("stage").select("id, index").eq("spec_version_id", version.id).returns<StageRow[]>()
      : { data: [] as StageRow[] };
    const stageUuid = (index: number) => stageRows?.find((s) => s.index === index)?.id ?? null;

    const touched = new Set<number>([
      ...events.utterances.map((u) => u.stageIndex),
      ...events.decisions.map((d) => d.stageIndex),
      ...(events.resolution ? [events.resolution.stageIndex] : []),
    ]);
    const binders = new Map<number, Promise<Binder>>();
    for (const index of touched) {
      const id = stageUuid(index);
      binders.set(index, id ? this.binder(record.spec, index, id) : Promise.resolve(emptyBinder()));
    }
    const bind = (index: number) => binders.get(index) ?? Promise.resolve(emptyBinder());

    const { error: stateError } = await this.admin.from("attempt_state").upsert(
      {
        attempt_id: record.attemptId,
        world_state: snapshot,
        journal: snapshot.journal,
        player_pos: snapshot.playerPos,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "attempt_id" },
    );
    if (stateError) throw new Error(`attempt_state: ${stateError.message}`);

    if (events.utterances.length > 0) {
      // One batch insert would give every row the same `created_at`; the transcript is ordered by
      // it, so each line gets the time it was spoken (or a millisecond per seq when unknown).
      const base = Date.now();
      const rows = await Promise.all(
        events.utterances.map(async ({ line, heardByPlayer, stageIndex }, i) => {
          const b = await bind(stageIndex);
          const isPlayer = line.speakerId === PLAYER_ID;
          const spokenAt = snapshot.stageIndex === stageIndex ? snapshot.spokenAt[line.seq] : undefined;
          return {
            attempt_id: record.attemptId,
            room_id: b.rooms.get(line.roomId) ?? null,
            author_type: isPlayer ? "player" : "agent",
            author_id: isPlayer ? record.studentId : b.agents.get(line.speakerId) ?? null,
            body: line.body,
            visibility: heardByPlayer ? "room" : "private",
            created_at: new Date((spokenAt ? new Date(spokenAt).getTime() : base) + i).toISOString(),
          };
        }),
      );
      const { error } = await this.admin.from("message").insert(rows);
      if (error) throw new Error(`message: ${error.message}`);
    }

    if (events.decisions.length > 0) {
      const rows = (
        await Promise.all(
          events.decisions.map(async ({ decision, stageIndex }) => {
            const stageId = stageUuid(stageIndex);
            const b = await bind(stageIndex);
            const agentId = decision.actorKind === "agent" ? b.agents.get(decision.actorId) ?? null : null;
            if (!stageId || (decision.actorKind === "agent" && !agentId)) return null;
            return {
              attempt_id: record.attemptId,
              stage_id: stageId,
              actor_kind: decision.actorKind,
              player_id: decision.actorKind === "player" ? record.studentId : null,
              agent_id: agentId,
              option_id: decision.optionId ? b.options.get(decision.optionId) ?? null : null,
            };
          }),
        )
      ).filter((row) => row !== null);
      // The uniqueness index is an expression (`coalesce(player_id, agent_id)`), which upsert cannot
      // target, so a re-recorded commitment is tolerated as a duplicate-key error instead.
      for (const row of rows) {
        const { error } = await this.admin.from("stage_commitment").insert(row);
        if (error && error.code !== "23505") throw new Error(`stage_commitment: ${error.message}`);
      }
    }

    if (events.resolution) {
      const stageId = stageUuid(events.resolution.stageIndex);
      if (stageId) {
        const { record: r } = events.resolution;
        const { error } = await this.admin.from("resolution").insert({
          attempt_id: record.attemptId,
          stage_id: stageId,
          actions: {},
          outcome: { ...r.outcome, rationale: r.rationale, privateNotes: r.privateNotes },
          rolls: r.rolls,
        });
        if (error) throw new Error(`resolution: ${error.message}`);
      }
    }

    if (events.endingId) {
      const { error } = await this.admin.rpc("complete_attempt", { p_attempt_id: record.attemptId, p_ending_id: events.endingId });
      if (error) throw new Error(`complete_attempt: ${error.message}`);
      return { stageDeadlineAt: null };
    }
    if (events.openedStageIndex !== null && events.openedStageIndex !== record.snapshot?.stageIndex) {
      const stageId = stageUuid(events.openedStageIndex);
      if (stageId) {
        const { data, error } = await this.admin.rpc("start_stage_deadline", { p_attempt_id: record.attemptId, p_stage_id: stageId });
        if (error) throw new Error(`start_stage_deadline: ${error.message}`);
        return { stageDeadlineAt: (data as string | null) ?? null };
      }
    }
    return { stageDeadlineAt: record.stageDeadlineAt };
  }

  async now(): Promise<Date> {
    const { data } = await this.admin.rpc("server_now");
    return data ? new Date(data as string) : new Date();
  }

  private async binder(spec: AdventureSpec, stageIndex: number, stageUuid: string): Promise<Binder> {
    const stage = spec.stages[stageIndex];
    if (!stage) return emptyBinder();
    const [{ data: rooms }, { data: agents }, { data: options }] = await Promise.all([
      this.admin.from("room").select("id, name, stage_id").eq("stage_id", stageUuid).returns<NamedRow[]>(),
      this.admin.from("agent").select("id, name, stage_id").eq("stage_id", stageUuid).returns<NamedRow[]>(),
      this.admin.from("decision_option").select("id, label, stage_id").eq("stage_id", stageUuid).returns<NamedRow[]>(),
    ]);
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
    this.saved.push({ snapshot: structuredClone(snapshot), events });
    const current = this.records.get(record.attemptId);
    if (!current) return { stageDeadlineAt: null };
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
