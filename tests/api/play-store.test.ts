import { loadI1Spec } from "@adventure/generation/fixtures";
import { beforeEach, describe, expect, it } from "vitest";

import { PlaySession, type PlayEvents, type PlaySnapshot } from "@/lib/play/session";
import { SupabasePlayStore, type AttemptRecord } from "@/lib/play/store";

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
  runtime: { stage_spec_id: string; revision: number; snapshot: unknown } | null = null;
  runtimeError: { message: string } | null = null;
  upserts: { table: string; values: unknown; options: unknown }[] = [];
  attempt: Record<string, unknown>;

  constructor(spec: Awaited<ReturnType<typeof loadI1Spec>>) {
    this.spec = spec;
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
    if (table === "attempt") return { data: this.attempt, error: null };
    if (table === "spec_version") return { data: { id: "version", json: this.spec }, error: null };
    if (table === "attempt_runtime") return { data: this.runtime, error: null };
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
    if (name === "save_attempt_runtime" && this.runtimeError) return Promise.resolve({ data: null, error: this.runtimeError });
    if (name === "save_attempt_runtime") return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: null });
  }
}

let spec: Awaited<ReturnType<typeof loadI1Spec>>;
let client: FakeClient;
let record: AttemptRecord;
let snapshot: PlaySnapshot;

beforeEach(async () => {
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
    };

    await new SupabasePlayStore(client as never).save(record, snapshot, events);
    const messageWrite = client.upserts.find((write) => write.table === "message");
    expect(messageWrite).toBeDefined();
    expect(messageWrite!.values as unknown[]).toHaveLength(1);
    expect((messageWrite!.values as { runtime_id: string }[])[0]!.runtime_id).toBe("attempt:0:1");
  });

  it("surfaces optimistic runtime save errors", async () => {
    client.runtimeError = { message: "revision conflict" };
    const events: PlayEvents = { utterances: [], decisions: [], resolution: null, openedStageIndex: null, endingId: null };

    await expect(new SupabasePlayStore(client as never).save(record, snapshot, events)).rejects.toThrow(/save_attempt_runtime/);
  });
});
