import { loadI1Spec } from "@adventure/generation/fixtures";
import type { AdventureSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AttemptNotFoundError,
  RuntimePersistenceError,
  SupabaseRuntimeStore,
} from "@/lib/turn-api/supabase-runtime";
import {
  createRuntimeAttempt,
  snapshotRuntimeAttempt,
} from "@/lib/turn-api/runtime";

const ATTEMPT_ID = "attempt-db-1";
const STUDENT_ID = "student-db-1";
const ADVENTURE_ID = "adventure-db-1";
const SPEC_VERSION_ID = "spec-version-db-1";
const STAGE_ZERO_DB_ID = "stage-db-0";
const STAGE_ONE_DB_ID = "stage-db-1";

class FakeQuery {
  private readonly filters: Record<string, unknown> = {};

  constructor(
    private readonly client: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns: string) {
    this.client.events.push({ kind: "select", table: this.table, columns });
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.client.select(this.table, this.filters));
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.client.select(this.table, this.filters)).then(onfulfilled, onrejected);
  }

  upsert(values: unknown, options?: unknown) {
    this.client.events.push({ kind: "upsert", table: this.table, values, options });
    return Promise.resolve(this.client.write(this.table, values, options));
  }

  insert(values: unknown) {
    this.client.events.push({ kind: "insert", table: this.table, values });
    return Promise.resolve(this.client.write(this.table, values));
  }
}

type Event = Record<string, unknown>;

class FakeSupabase {
  readonly events: Event[] = [];
  readonly attempts: Record<string, unknown>;
  runtime: Record<string, unknown> | null = null;
  specJson: unknown;
  stableRows: Record<string, Array<{ id: string; spec_id: string | null }>> = {};
  rpcErrors = new Map<string, { message: string; code?: string }>();
  userAuthorized = true;
  userAuthError = false;
  private revision = 0;

  constructor(private readonly spec: AdventureSpec) {
    this.specJson = spec;
    this.attempts = {
      id: ATTEMPT_ID,
      adventure_id: ADVENTURE_ID,
      published_version: 7,
      student_id: STUDENT_ID,
      current_stage_id: STAGE_ZERO_DB_ID,
      status: "active",
      ending_id: null,
      stage_deadline_at: new Date(Date.now() + 480_000).toISOString(),
    };
    for (const stage of spec.stages) {
      const stageDbId = stage.index === 0 ? STAGE_ZERO_DB_ID : STAGE_ONE_DB_ID;
      this.stableRows[stageDbId] = [
        ...stage.rooms.map((room) => ({ id: `room-db-${room.id}`, spec_id: room.id })),
        ...stage.agents.map((agent) => ({ id: `agent-db-${agent.id}`, spec_id: agent.id })),
        ...stage.decision.options.map((option) => ({ id: `option-db-${option.id}`, spec_id: option.id })),
      ];
    }
  }

  from(table: string) {
    if (this === adminClient && table === "attempt" && !this.userAuthorized) {
      throw new Error("admin was queried before authorization");
    }
    return new FakeQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.events.push({ kind: "rpc", name, args });
    const error = this.rpcErrors.get(name);
    if (error) return Promise.resolve({ data: null, error });
    if (name === "save_attempt_runtime") {
      this.revision += 1;
      this.runtime = {
        stage_spec_id: args.p_stage_spec_id,
        revision: this.revision,
        snapshot: args.p_snapshot,
      };
      return Promise.resolve({ data: this.revision, error: null });
    }
    if (name === "start_stage_deadline") {
      this.attempts.current_stage_id = args.p_stage_id === STAGE_ONE_DB_ID ? STAGE_ONE_DB_ID : STAGE_ZERO_DB_ID;
      return Promise.resolve({ data: new Date(Date.now() + 600_000).toISOString(), error: null });
    }
    if (name === "complete_attempt") {
      this.attempts.status = "completed";
      this.attempts.current_stage_id = null;
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`unexpected RPC ${name}`);
  }

  select(table: string, filters: Record<string, unknown>) {
    if (table === "attempt") {
      if (this === userClient) {
        if (this.userAuthError) return { data: null, error: { message: "auth unavailable" } };
        return this.userAuthorized
          ? { data: { id: ATTEMPT_ID }, error: null }
          : { data: null, error: null };
      }
      return { data: this.attempts, error: null };
    }
    if (table === "spec_version") {
      return { data: { id: SPEC_VERSION_ID, json: this.specJson }, error: null };
    }
    if (table === "attempt_runtime") return { data: this.runtime, error: null };
    if (table === "stage") {
      const byId = Object.entries(this.stageRows()).find(([id]) => id === filters.id)?.[1];
      if (byId !== undefined) return { data: byId, error: null };
      const stage = this.spec.stages.find((candidate) => candidate.id === filters.spec_id);
      if (stage === undefined) return { data: null, error: null };
      return {
        data: {
          id: stage.index === 0 ? STAGE_ZERO_DB_ID : STAGE_ONE_DB_ID,
          index: stage.index,
          spec_id: stage.id,
          spec_version_id: SPEC_VERSION_ID,
        },
        error: null,
      };
    }
    if (table === "room" || table === "agent" || table === "decision_option") {
      return { data: this.rowsFor(table, String(filters.stage_id)), error: null };
    }
    throw new Error(`unexpected select ${table}`);
  }

  write(table: string, values: unknown) {
    if (table === "stage_commitment" || table === "resolution" || table === "message" || table === "attempt_state") {
      return { data: values, error: null };
    }
    throw new Error(`unexpected write ${table}`);
  }

  private stageRows() {
    return {
      [STAGE_ZERO_DB_ID]: { id: STAGE_ZERO_DB_ID, index: 0, spec_id: "stage-landing", spec_version_id: SPEC_VERSION_ID },
      [STAGE_ONE_DB_ID]: { id: STAGE_ONE_DB_ID, index: 1, spec_id: "stage-sultan", spec_version_id: SPEC_VERSION_ID },
    };
  }

  private rowsFor(table: string, stageId: string) {
    const configured = this.stableRows[stageId] ?? [];
    if (configured.length === 1 && configured[0]?.spec_id === null) return configured;
    const stage = this.spec.stages[stageId === STAGE_ZERO_DB_ID ? 0 : 1];
    if (stage === undefined) return [];
    const records =
      table === "room"
        ? stage.rooms.map((room) => ({ id: `room-db-${room.id}`, spec_id: room.id }))
        : table === "agent"
          ? stage.agents.map((agent) => ({ id: `agent-db-${agent.id}`, spec_id: agent.id }))
          : stage.decision.options.map((option) => ({ id: `option-db-${option.id}`, spec_id: option.id }));
    return records;
  }
}

let userClient: FakeSupabase;
let adminClient: FakeSupabase;

beforeEach(async () => {
  const spec = await loadI1Spec();
  userClient = new FakeSupabase(spec);
  adminClient = new FakeSupabase(spec);
});

function store() {
  return new SupabaseRuntimeStore(
    userClient as unknown as SupabaseClient,
    adminClient as unknown as SupabaseClient,
  );
}

describe("SupabaseRuntimeStore", () => {
  it("authorizes through the user client before reading admin data", async () => {
    userClient.userAuthorized = false;

    await expect(store().getState(ATTEMPT_ID)).rejects.toBeInstanceOf(AttemptNotFoundError);
    expect(adminClient.events).toEqual([]);
  });

  it("surfaces authorization query errors without reading admin data", async () => {
    userClient.userAuthError = true;

    await expect(store().getState(ATTEMPT_ID)).rejects.toThrow(/authorize attempt/);
    expect(adminClient.events).toEqual([]);
  });

  it("rejects an invalid pinned spec", async () => {
    adminClient.specJson = { invalid: true };

    await expect(store().getState(ATTEMPT_ID)).rejects.toBeInstanceOf(RuntimePersistenceError);
  });

  it("initializes a missing runtime with optimistic revision zero", async () => {
    const state = await store().getState(ATTEMPT_ID);

    expect(state.adventureId).toBe(ADVENTURE_ID);
    expect(state.publishedVersion).toBe(7);
    expect(adminClient.events.find((event) => event.kind === "rpc" && event.name === "save_attempt_runtime")).toMatchObject({
      args: expect.objectContaining({ p_expected_revision: 0 }),
    });
    const stateWrite = adminClient.events.find((event) => event.kind === "upsert" && event.table === "attempt_state");
    expect(stateWrite).toBeDefined();
    const serialized = JSON.stringify(stateWrite?.values);
    expect(serialized).not.toContain("privateNotes");
    expect(serialized).not.toContain("rolls");
    expect(serialized).not.toContain("rationale");
  });

  it("rejects missing stable ids and does not expose private spec data", async () => {
    adminClient.stableRows[STAGE_ZERO_DB_ID] = [
      { id: "room-db-landing-beach", spec_id: null },
    ];
    await expect(store().postMessage(ATTEMPT_ID, "landing-beach", "Hello")).rejects.toBeInstanceOf(
      RuntimePersistenceError,
    );
  });

  it("restores matching completed state and rejects ending mismatches", async () => {
    const spec = await loadI1Spec();
    const attempt = createRuntimeAttempt(spec);
    attempt.endingId = "end-forced-landing";
    adminClient.attempts.status = "completed";
    adminClient.attempts.ending_id = "end-forced-landing";
    adminClient.runtime = {
      stage_spec_id: "stage-landing",
      revision: 4,
      snapshot: snapshotRuntimeAttempt(attempt),
    };
    adminClient.revision = 4;

    await expect(store().getState(ATTEMPT_ID)).resolves.toMatchObject({ status: "completed" });

    adminClient.attempts.ending_id = "end-riau-refusal";
    await expect(store().getState(ATTEMPT_ID)).rejects.toThrow(/ending does not match/);

    adminClient.attempts.status = "active";
    adminClient.attempts.ending_id = null;
    await expect(store().getState(ATTEMPT_ID)).rejects.toThrow(/completed runtime/);
  });

  it("restores a stored snapshot without initializing a fixture runtime", async () => {
    const spec = await loadI1Spec();
    const attempt = createRuntimeAttempt(spec);
    adminClient.runtime = {
      stage_spec_id: "stage-landing",
      revision: 4,
      snapshot: snapshotRuntimeAttempt(attempt),
    };
    adminClient.revision = 4;

    await store().getState(ATTEMPT_ID);

    expect(adminClient.events.some((event) => event.kind === "rpc" && event.name === "save_attempt_runtime")).toBe(false);
  });

  it("writes message rows with relational UUIDs and only public state", async () => {
    const result = await store().postMessage(ATTEMPT_ID, "landing-beach", "What is the plan?");

    expect(result.ok).toBe(true);
    const messageWrite = adminClient.events.find((event) => event.kind === "upsert" && event.table === "message");
    expect(messageWrite).toBeDefined();
    expect(JSON.stringify(messageWrite?.values)).toContain("room-db-landing-beach");
    expect(JSON.stringify(messageWrite?.values)).toContain(STUDENT_ID);
    const stateWrite = adminClient.events.find((event) => event.kind === "upsert" && event.table === "attempt_state");
    expect(JSON.stringify(stateWrite?.values)).not.toContain("privateContext");
    expect(JSON.stringify(stateWrite?.values)).not.toContain("fears the Sultan in Riau will repudiate");
  });

  it("writes commitments and private resolution while advancing the deadline", async () => {
    await store().postMessage(ATTEMPT_ID, "ship-cabin", "Show me the instructions.");
    const result = await store().commitDecision(ATTEMPT_ID, "opt-sign-preliminary");

    expect(result?.resolution.nextStageId).toBe("stage-sultan");
    expect(adminClient.events.some((event) => event.kind === "insert" && event.table === "stage_commitment")).toBe(true);
    const resolutionWrite = adminClient.events.find((event) => event.kind === "upsert" && event.table === "resolution");
    expect(JSON.stringify(resolutionWrite?.values)).toContain("privateNotes");
    expect(adminClient.events.some((event) => event.kind === "rpc" && event.name === "start_stage_deadline")).toBe(true);
  });

  it("persists nothing for a stale decision", async () => {
    await store().getState(ATTEMPT_ID);
    adminClient.events.length = 0;
    const result = await store().commitDecision(ATTEMPT_ID, "opt-sign-preliminary");

    expect(result).toBeNull();
    expect(adminClient.events.some((event) => event.kind === "insert" || event.kind === "upsert" || event.kind === "rpc")).toBe(false);
  });

  it("surfaces optimistic runtime RPC errors", async () => {
    adminClient.rpcErrors.set("save_attempt_runtime", { message: "revision conflict", code: "40001" });

    await expect(store().getState(ATTEMPT_ID)).rejects.toThrow(/save attempt runtime/);
  });
});
