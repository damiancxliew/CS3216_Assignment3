import { loadI1Spec } from "@adventure/generation/fixtures";
import type { CompiledStage } from "@adventure/game-core";
import { beforeEach, describe, expect, it } from "vitest";

import { compileStageMap } from "@/lib/play/layout";
import { PlaySession, type PlayEvents, type PlaySnapshot } from "@/lib/play/session";
import { MemoryPlayStore, PlayConflictError, RuntimeConflictError, SupabasePlayStore, type AttemptRecord } from "@/lib/play/store";
import { clearVersionCache } from "@/lib/play/version-cache";

class Query {
  private filters: Record<string, unknown> = {};
  constructor(private readonly client: FakeClient, private readonly table: string) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters[column] = value; return this; }
  maybeSingle() { return Promise.resolve(this.client.read(this.table, this.filters)); }
  single() { return Promise.resolve(this.client.read(this.table, this.filters)); }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) { return Promise.resolve(this.client.read(this.table, this.filters)).then(onfulfilled, onrejected); }
  returns<T>() { return this as unknown as Query; }
  upsert(values: unknown, options: unknown) {
    this.client.upserts.push({ table: this.table, values, options });
    return Promise.resolve({ data: null, error: null });
  }
}

class FakeClient {
  readonly spec: Awaited<ReturnType<typeof loadI1Spec>>;
  readonly compiledStages: CompiledStage[];
  runtime: { stage_spec_id: string; revision: number; snapshot: unknown } | null = null;
  runtimeError: { code?: string; message: string } | null = null;
  runtimeReadError: { message: string } | null = null;
  versionReadError: { message: string } | null = null;
  upserts: { table: string; values: unknown; options: unknown }[] = [];
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  reads: Record<string, number> = {};
  rpcResult: { data: unknown; error: { message: string; code?: string } | null } = { data: { runtimeRevision: 1, stageDeadlineAt: null }, error: null };
  attempt: Record<string, unknown>;

  constructor(spec: Awaited<ReturnType<typeof loadI1Spec>>) {
    this.spec = spec;
    this.compiledStages = spec.stages.map((stage) => compileStageMap(stage, "stored-maps-test"));
    this.attempt = {
      id: "attempt",
      adventure_id: "adventure",
      published_version: 1,
      student_id: "student",
      status: "active",
      ending_id: null,
      current_stage_id: "stage-db-0",
      stage_deadline_at: null,
    };
  }

  from(table: string) { return new Query(this, table); }

  read(table: string, filters: Record<string, unknown>) {
    this.reads[table] = (this.reads[table] ?? 0) + 1;
    if (table === "attempt") return { data: this.attempt, error: null };
    if (table === "spec_version") {
      return this.versionReadError
        ? { data: null, error: this.versionReadError }
        : { data: { id: "version", json: this.spec, compiled_stages: this.compiledStages }, error: null };
    }
    if (table === "attempt_runtime") return this.runtimeReadError ? { data: null, error: this.runtimeReadError } : { data: this.runtime, error: null };
    if (table === "room" || table === "agent" || table === "decision_option") {
      const stageIndex = Number(String(filters.stage_id).split("-").at(-1));
      const stage = this.spec.stages[Number.isInteger(stageIndex) ? stageIndex : 0]!;
      if (table === "room") return { data: stage.rooms.map((room) => ({ id: `room-db-${room.id}`, spec_id: room.id, stage_id: filters.stage_id })), error: null };
      if (table === "agent") return { data: stage.agents.map((agent) => ({ id: `agent-db-${agent.id}`, spec_id: agent.id, stage_id: filters.stage_id })), error: null };
      return { data: stage.decision.options.map((option) => ({ id: `option-db-${option.id}`, spec_id: option.id, stage_id: filters.stage_id })), error: null };
    }
    if (table === "stage") {
      if (filters.spec_id === undefined && filters.id === undefined) {
        return { data: this.spec.stages.map((stage) => ({ id: `stage-db-${stage.index}`, index: stage.index, spec_id: stage.id, spec_version_id: "version" })), error: null };
      }
      const requestedIndex = typeof filters.id === "string" ? Number(String(filters.id).split("-").at(-1)) : Number(filters.index);
      const stageIndex = this.spec.stages.findIndex((stage) => stage.id === filters.spec_id);
      const stage = stageIndex >= 0 ? this.spec.stages[stageIndex] : this.spec.stages[Number.isInteger(requestedIndex) ? requestedIndex : 0];
      return { data: stage ? { id: `stage-db-${stage.index}`, index: stage.index, spec_id: stage.id, spec_version_id: "version" } : null, error: null };
    }
    return { data: [], error: null };
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return Promise.resolve(this.rpcResult);
  }
}

let spec: Awaited<ReturnType<typeof loadI1Spec>>;
let client: FakeClient;
let record: AttemptRecord;
let snapshot: PlaySnapshot;

beforeEach(async () => {
  clearVersionCache();
  spec = await loadI1Spec();
  client = new FakeClient(spec);
  const session = PlaySession.start(spec, "attempt", 1);
  snapshot = session.snapshot();
  record = {
    attemptId: "attempt",
    studentId: "student",
    adventureId: "adventure",
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec,
    snapshot,
    runtimeRevision: 0,
  };
});

describe("SupabasePlayStore runtime validation", () => {
  it("rejects invalid and mismatched stored snapshots", async () => {
    client.runtime = { stage_spec_id: "stage-landing", revision: 1, snapshot: { version: 1, stageIndex: 99, world: {} } };
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/invalid/);

    client.runtime = { stage_spec_id: "wrong-stage", revision: 1, snapshot };
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/stage/);

    client.runtime = {
      stage_spec_id: "stage-landing",
      revision: 1,
      snapshot: { ...snapshot, endingId: "end-forced-landing" },
    };
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/completed/);
  });

  it("rejects active stage mismatches, progressed active attempts without runtime, and completed attempts without runtime", async () => {
    client.attempt.current_stage_id = "stage-db-1";
    client.runtime = { stage_spec_id: "stage-landing", revision: 1, snapshot };
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/stage/);

    client.runtime = null;
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/opening stage/);

    client.attempt.status = "completed";
    client.attempt.current_stage_id = null;
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/opening stage/);
  });

  it("deduplicates duplicate utterance runtime ids within one save", async () => {
    const line = {
      tick: 0,
      seq: 1,
      roomId: spec.stages[0]!.spawnRoomId,
      speakerId: "player",
      speakerName: "You",
      addresseeId: null,
      body: "Repeated line",
    };
    const events: PlayEvents = {
      utterances: [
        { line, heardByPlayer: true, stageIndex: 0 },
        { line, heardByPlayer: true, stageIndex: 0 },
      ],
      decisions: [],
      resolution: null,
      openedStageIndex: null,
      endingId: null,
      telemetry: null,
    };

    await new SupabasePlayStore(client as never).save(record, snapshot, events);
    expect(client.upserts).toHaveLength(0);
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]!.name).toBe("save_play_turn");
    expect((client.rpcCalls[0]!.args.p_messages as { runtime_id: string }[])).toHaveLength(1);
    expect((client.rpcCalls[0]!.args.p_messages as { runtime_id: string }[])[0]!.runtime_id).toBe("attempt:0:1");
  });

  it("sends a minted decision by spec id while sending the current catalogue", async () => {
    const minted = {
      id: "minted-stage-landing-1234",
      label: "Offer a temporary anchorage",
      preconditions: [{ kind: "actor_in_room", actorId: "player", roomId: "landing-beach" }],
      branchTarget: { kind: "stage" as const, stageId: "stage-sultan" },
      stance: "cooperative" as const,
      stageId: "stage-landing",
    };
    const mintedSnapshot = { ...snapshot, mintedOptions: [minted] };
    const events: PlayEvents = {
      utterances: [],
      decisions: [{ stageIndex: 0, decision: { actorId: "player", actorKind: "player", optionId: minted.id } }],
      resolution: null,
      openedStageIndex: null,
      endingId: null,
      telemetry: null,
    };

    const store = new SupabasePlayStore(client as never);
    await store.save(record, mintedSnapshot, events);

    const args = client.rpcCalls[0]!.args;
    expect(args.p_minted_options).toEqual([{
      stage_id: "stage-db-0",
      spec_id: minted.id,
      label: minted.label,
      preconditions: minted.preconditions,
      branch_target: "stage-db-1",
    }]);
    expect(args.p_commitments).toEqual([expect.objectContaining({
      option_id: null,
      minted_spec_id: minted.id,
    })]);

    client.runtime = { stage_spec_id: "stage-landing", revision: 1, snapshot: mintedSnapshot };
    const loaded = await store.load("attempt", "student");
    expect(loaded?.snapshot?.mintedOptions).toEqual([minted]);
  });

  it("rejects a stale second in-memory reader before saving", async () => {
    const store = new MemoryPlayStore([record]);
    const first = (await store.load("attempt", "student"))!;
    const second = (await store.load("attempt", "student"))!;
    const next = { ...snapshot, revision: snapshot.revision + 1 };
    const events: PlayEvents = { utterances: [], decisions: [], resolution: null, openedStageIndex: null, endingId: null, telemetry: null };
    await store.save(first, next, events);
    await expect(store.save(second, { ...next, revision: next.revision + 1 }, events)).rejects.toBeInstanceOf(PlayConflictError);
    expect(store.saved).toHaveLength(1);
  });

  it("maps a save_play_turn conflict to RuntimeConflictError", async () => {
    client.rpcResult = { data: null, error: { code: "40001", message: "revision conflict" } };
    const events: PlayEvents = { utterances: [], decisions: [], resolution: null, openedStageIndex: null, endingId: null, telemetry: null };

    await expect(new SupabasePlayStore(client as never).save(record, snapshot, events)).rejects.toBeInstanceOf(RuntimeConflictError);
    await expect(new SupabasePlayStore(client as never).save(record, snapshot, events)).rejects.toMatchObject({ name: "PlayConflictError", message: "The attempt changed. Refresh and try again." });
  });

  it("surfaces non-conflict save errors and refuses failed runtime reads", async () => {
    client.rpcResult = { data: null, error: { message: "out of disk" } };
    const events: PlayEvents = { utterances: [], decisions: [], resolution: null, openedStageIndex: null, endingId: null, telemetry: null };
    await expect(new SupabasePlayStore(client as never).save(record, snapshot, events)).rejects.toThrow(/save_play_turn/);
    client.runtimeReadError = { message: "Timed out acquiring connection from connection pool." };
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/attempt_runtime/);
  });

  it("refuses a failed pinned-version read instead of reporting no such attempt", async () => {
    client.runtimeReadError = null;
    client.versionReadError = { message: `column spec_version.compiled_stages does not exist` };
    await expect(new SupabasePlayStore(client as never).load("attempt", "student")).rejects.toThrow(/spec_version/);
  });

  it("reuses immutable version and stage rows on a second load", async () => {
    client.runtime = { stage_spec_id: spec.stages[0]!.id, revision: 1, snapshot };
    const store = new SupabasePlayStore(client as never);

    await store.load("attempt", "student");
    const firstVersionReads = client.reads.spec_version;
    const firstStageReads = client.reads.stage;
    await store.load("attempt", "student");

    expect(client.reads.spec_version).toBe(firstVersionReads);
    expect(client.reads.stage).toBe(firstStageReads);
  });
});
