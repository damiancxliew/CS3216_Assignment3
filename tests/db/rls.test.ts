/**
 * P2 — RLS. Every table gets a negative test from a second account: a teacher
 * must not see another teacher's adventure, a student must not see another
 * student's attempt, and nobody but the service role may read private agent
 * context, agent memory or resolver rolls (FR-21).
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

type Fixture = {
  teacherId: string;
  adventureId: string;
  sourceId: string;
  chunkId: string;
  specVersionId: string;
  draftSpecVersionId: string;
  stageId: string;
  roomId: string;
  agentId: string;
  evidenceId: string;
  objectiveId: string;
  decisionOptionId: string;
  mapArtifactId: string;
  attemptId: string;
  studentId: string;
  roomMessageId: string;
  privateMessageId: string;
  resolutionId: string;
  playerCommitmentId: string;
  agentCommitmentId: string;
};

async function insert<T extends Record<string, unknown>>(
  table: string,
  row: T,
): Promise<{ id: string }> {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as { id: string };
}

async function seedAdventure(title: string, teacherId: string, studentId: string) {
  const adventure = await insert("adventure", {
    owner_id: teacherId,
    title,
    setting: "1947",
    status: "published",
    published_version: 1,
    default_timer_seconds: 600,
  });

  const source = await insert("source", {
    adventure_id: adventure.id,
    kind: "text",
    title: "Council minutes",
    storage_key: `sources/${adventure.id}.txt`,
  });

  const chunk = await insert("source_chunk", {
    source_id: source.id,
    chunk_index: 0,
    body: "The council met at dawn.",
    page_from: 1,
    page_to: 1,
  });

  const specVersion = await insert("spec_version", {
    adventure_id: adventure.id,
    version: 1,
    json: { stages: [] },
    generator_version: "test",
    published_at: new Date().toISOString(),
  });

  // A later draft the teacher is editing: an in-flight attempt is pinned to
  // version 1 and must not see it (P4).
  const draftSpecVersion = await insert("spec_version", {
    adventure_id: adventure.id,
    version: 2,
    json: { stages: [], note: "edited after publish" },
    generator_version: "test",
  });

  const stage = await insert("stage", {
    spec_version_id: specVersion.id,
    index: 0,
    title: "The vote",
    shared_context: "Everyone knows the fleet is three days out.",
  });

  const room = await insert("room", { stage_id: stage.id, name: "Chamber" });

  const agent = await insert("agent", {
    stage_id: stage.id,
    name: "Envoy Marisel",
    role: "Envoy",
    public_position: "Keep the strait open.",
    start_room_id: room.id,
  });

  const { error: privateError } = await admin
    .from("agent_private_context")
    .insert({
      agent_id: agent.id,
      private_context: "Secretly bankrolled by the grain merchants.",
      knowledge_horizon: "Does not know the fleet has already sailed.",
    });
  if (privateError) throw privateError;

  const evidence = await insert("evidence", {
    stage_id: stage.id,
    room_id: room.id,
    text: "A grain ledger.",
    source_span: { page: 14 },
  });

  const objective = await insert("objective", {
    stage_id: stage.id,
    title: "Hear both delegations",
  });

  const decisionOption = await insert("decision_option", {
    stage_id: stage.id,
    label: "Vote for the blockade",
  });

  const mapArtifact = await insert("map_artifact", {
    stage_id: stage.id,
    seed: 42,
    generator_version: "test",
    json: { tiles: [] },
  });

  const attempt = await insert("attempt", {
    adventure_id: adventure.id,
    published_version: 1,
    student_id: studentId,
    current_stage_id: stage.id,
    stage_deadline_at: new Date(Date.now() + 600_000).toISOString(),
  });

  const { error: stateError } = await admin
    .from("attempt_state")
    .insert({ attempt_id: attempt.id, world_state: { mood: "tense" } });
  if (stateError) throw stateError;

  const { error: memoryError } = await admin.from("agent_memory").insert({
    attempt_id: attempt.id,
    agent_id: agent.id,
    transcript: [{ body: "hello" }],
    private_notes: [{ body: "the player is bluffing" }],
  });
  if (memoryError) throw memoryError;

  const roomMessage = await insert("message", {
    attempt_id: attempt.id,
    room_id: room.id,
    author_type: "agent",
    author_id: agent.id,
    body: "You are late.",
    visibility: "room",
  });

  const privateMessage = await insert("message", {
    attempt_id: attempt.id,
    room_id: room.id,
    author_type: "agent",
    author_id: agent.id,
    body: "Behind the closed door: we sink the convoy tonight.",
    visibility: "private",
  });

  const resolution = await insert("resolution", {
    attempt_id: attempt.id,
    stage_id: stage.id,
    actions: { player: "abstain" },
    outcome: { announcement: "The vote carries." },
    rolls: { d100: 73 },
  });

  const playerCommitment = await insert("stage_commitment", {
    attempt_id: attempt.id,
    stage_id: stage.id,
    actor_kind: "player",
    player_id: studentId,
    option_id: decisionOption.id,
  });

  const agentCommitment = await insert("stage_commitment", {
    attempt_id: attempt.id,
    stage_id: stage.id,
    actor_kind: "agent",
    agent_id: agent.id,
    option_id: decisionOption.id,
  });

  return {
    teacherId,
    adventureId: adventure.id,
    sourceId: source.id,
    chunkId: chunk.id,
    specVersionId: specVersion.id,
    draftSpecVersionId: draftSpecVersion.id,
    stageId: stage.id,
    roomId: room.id,
    agentId: agent.id,
    evidenceId: evidence.id,
    objectiveId: objective.id,
    decisionOptionId: decisionOption.id,
    mapArtifactId: mapArtifact.id,
    attemptId: attempt.id,
    studentId,
    roomMessageId: roomMessage.id,
    privateMessageId: privateMessage.id,
    resolutionId: resolution.id,
    playerCommitmentId: playerCommitment.id,
    agentCommitmentId: agentCommitment.id,
  } satisfies Fixture;
}

let teacherA: SupabaseClient;
let teacherB: SupabaseClient;
let studentA: SupabaseClient;
let studentB: SupabaseClient;
let fixtureA: Fixture;
let fixtureB: Fixture;

beforeAll(async () => {
  const a = await createUserClient(uniqueEmail("teacher-a"));
  const b = await createUserClient(uniqueEmail("teacher-b"));
  const sa = await createUserClient(uniqueEmail("student-a"));
  const sb = await createUserClient(uniqueEmail("student-b"));
  teacherA = a.client;
  teacherB = b.client;
  studentA = sa.client;
  studentB = sb.client;

  fixtureA = await seedAdventure("Adventure A", a.userId, sa.userId);
  fixtureB = await seedAdventure("Adventure B", b.userId, sb.userId);
});

/**
 * Counts the rows a client can see. A query error is a broken grant or a
 * broken query, not an RLS denial — denial shows up as zero rows — so it fails
 * loudly instead of silently counting as isolation.
 */
async function rows(client: SupabaseClient, table: string, id: string, column = "id") {
  const { data, error } = await client.from(table).select(column).eq(column, id);
  if (error) throw new Error(`${table}.${column}: ${error.message}`);
  return { count: data?.length ?? 0 };
}

describe("adventure", () => {
  it("is readable by its owner", async () => {
    expect((await rows(teacherA, "adventure", fixtureA.adventureId)).count).toBe(1);
  });

  it("is not readable by another teacher", async () => {
    expect((await rows(teacherB, "adventure", fixtureA.adventureId)).count).toBe(0);
  });

  it("is readable by a student who has an attempt on it, and not by one who does not", async () => {
    expect((await rows(studentA, "adventure", fixtureA.adventureId)).count).toBe(1);
    expect((await rows(studentB, "adventure", fixtureA.adventureId)).count).toBe(0);
  });

  it("cannot be created on behalf of another user", async () => {
    const { error } = await teacherB
      .from("adventure")
      .insert({ owner_id: fixtureA.teacherId, title: "Stolen" });
    expect(error).not.toBeNull();
  });

  it("cannot be updated by another teacher", async () => {
    const { data } = await teacherB
      .from("adventure")
      .update({ title: "Vandalised" })
      .eq("id", fixtureA.adventureId)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("source and source_chunk", () => {
  it("are teacher-only", async () => {
    expect((await rows(teacherA, "source", fixtureA.sourceId)).count).toBe(1);
    expect((await rows(teacherB, "source", fixtureA.sourceId)).count).toBe(0);
    expect((await rows(studentA, "source", fixtureA.sourceId)).count).toBe(0);
    expect((await rows(teacherA, "source_chunk", fixtureA.chunkId)).count).toBe(1);
    expect((await rows(teacherB, "source_chunk", fixtureA.chunkId)).count).toBe(0);
    expect((await rows(studentA, "source_chunk", fixtureA.chunkId)).count).toBe(0);
  });
});

describe("spec_version", () => {
  it("exposes only the published version the attempt is pinned to (P4)", async () => {
    expect((await rows(studentA, "spec_version", fixtureA.specVersionId)).count).toBe(1);
    expect((await rows(studentA, "spec_version", fixtureA.draftSpecVersionId)).count).toBe(
      0,
    );
  });

  it("is not readable by another teacher or another student", async () => {
    expect((await rows(teacherB, "spec_version", fixtureA.specVersionId)).count).toBe(0);
    expect((await rows(studentB, "spec_version", fixtureA.specVersionId)).count).toBe(0);
  });
});

describe.each([
  ["stage", "stageId"],
  ["room", "roomId"],
  ["agent", "agentId"],
  ["evidence", "evidenceId"],
  ["objective", "objectiveId"],
  ["decision_option", "decisionOptionId"],
  ["map_artifact", "mapArtifactId"],
] as const)("%s", (table, key) => {
  it("is readable by the owning teacher and their student only", async () => {
    const id = fixtureA[key];
    expect((await rows(teacherA, table, id)).count).toBe(1);
    expect((await rows(studentA, table, id)).count).toBe(1);
    expect((await rows(teacherB, table, id)).count).toBe(0);
    expect((await rows(studentB, table, id)).count).toBe(0);
  });
});

describe("attempt and attempt_state", () => {
  it("are visible to the student who owns them and to the teacher of the adventure", async () => {
    expect((await rows(studentA, "attempt", fixtureA.attemptId)).count).toBe(1);
    expect((await rows(teacherA, "attempt", fixtureA.attemptId)).count).toBe(1);
    expect(
      (await rows(studentA, "attempt_state", fixtureA.attemptId, "attempt_id")).count,
    ).toBe(1);
  });

  it("are invisible to another student and another teacher", async () => {
    expect((await rows(studentB, "attempt", fixtureA.attemptId)).count).toBe(0);
    expect((await rows(teacherB, "attempt", fixtureA.attemptId)).count).toBe(0);
    expect(
      (await rows(studentB, "attempt_state", fixtureA.attemptId, "attempt_id")).count,
    ).toBe(0);
    expect(
      (await rows(teacherB, "attempt_state", fixtureA.attemptId, "attempt_id")).count,
    ).toBe(0);
  });

  it("cannot be created by a student for someone else", async () => {
    const { error } = await studentB.from("attempt").insert({
      adventure_id: fixtureA.adventureId,
      published_version: 1,
      student_id: fixtureA.studentId,
    });
    expect(error).not.toBeNull();
  });
});

describe("message", () => {
  it("shows room traffic to the player and the teacher, but never private traffic", async () => {
    expect((await rows(studentA, "message", fixtureA.roomMessageId)).count).toBe(1);
    expect((await rows(teacherA, "message", fixtureA.roomMessageId)).count).toBe(1);
    expect((await rows(studentA, "message", fixtureA.privateMessageId)).count).toBe(0);
    expect((await rows(teacherA, "message", fixtureA.privateMessageId)).count).toBe(0);
  });

  it("is invisible across attempts", async () => {
    expect((await rows(studentB, "message", fixtureA.roomMessageId)).count).toBe(0);
    expect((await rows(teacherB, "message", fixtureA.roomMessageId)).count).toBe(0);
  });
});

describe("decision_option", () => {
  it("exposes the label but never the preconditions or the branch target", async () => {
    const { data, error } = await studentA
      .from("decision_option")
      .select("id, label")
      .eq("id", fixtureA.decisionOptionId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);

    for (const column of ["preconditions", "branch_target"]) {
      const denied = await studentA
        .from("decision_option")
        .select(column)
        .eq("id", fixtureA.decisionOptionId);
      expect(denied.error).not.toBeNull();
      expect(denied.data ?? []).toHaveLength(0);
    }
  });
});

describe("stage_commitment (D18/FR-14)", () => {
  it("shows player and agent commitments to the owning student and teacher only", async () => {
    for (const id of [fixtureA.playerCommitmentId, fixtureA.agentCommitmentId]) {
      expect((await rows(studentA, "stage_commitment", id)).count).toBe(1);
      expect((await rows(teacherA, "stage_commitment", id)).count).toBe(1);
      expect((await rows(studentB, "stage_commitment", id)).count).toBe(0);
      expect((await rows(teacherB, "stage_commitment", id)).count).toBe(0);
    }
  });

  it("never exposes which option an actor chose, even on your own attempt", async () => {
    for (const client of [studentA, teacherA]) {
      const { data, error } = await client
        .from("stage_commitment")
        .select("option_id")
        .eq("attempt_id", fixtureA.attemptId);
      expect(error).not.toBeNull();
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("cannot be written by a client", async () => {
    const { error } = await studentA.from("stage_commitment").insert({
      attempt_id: fixtureA.attemptId,
      stage_id: fixtureA.stageId,
      actor_kind: "player",
      player_id: fixtureA.studentId,
    });
    expect(error).not.toBeNull();
  });
});

describe("server-authority tables (FR-21)", () => {
  it("never expose private agent context to any client role", async () => {
    for (const client of [teacherA, teacherB, studentA, studentB]) {
      const { data, error } = await client
        .from("agent_private_context")
        .select("private_context")
        .eq("agent_id", fixtureA.agentId);
      expect(error ?? { message: "" }).toBeTruthy();
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("never expose agent memory or resolver rolls to any client role", async () => {
    for (const client of [teacherA, studentA]) {
      const memory = await client
        .from("agent_memory")
        .select("private_notes")
        .eq("attempt_id", fixtureA.attemptId);
      expect(memory.data ?? []).toHaveLength(0);

      const resolutions = await client
        .from("resolution")
        .select("rolls")
        .eq("attempt_id", fixtureA.attemptId);
      expect(resolutions.data ?? []).toHaveLength(0);
    }
  });
});

describe("profile", () => {
  it("is readable only by its owner", async () => {
    expect((await rows(studentA, "profile", fixtureA.studentId)).count).toBe(1);
    expect((await rows(studentB, "profile", fixtureA.studentId)).count).toBe(0);
  });
});

describe("cross-adventure isolation", () => {
  it("keeps teacher B's adventure invisible to teacher A", async () => {
    expect((await rows(teacherA, "adventure", fixtureB.adventureId)).count).toBe(0);
    expect((await rows(teacherA, "attempt", fixtureB.attemptId)).count).toBe(0);
  });
});
