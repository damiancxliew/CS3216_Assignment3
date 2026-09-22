import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

type WorldStateRow = { revision?: unknown; world?: Record<string, unknown>; [key: string]: unknown };
type Seeded = { attemptId: string; stageIds: [string, string]; roomIds: [string, string] };

const admin = serviceClient();
let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };
let otherStudent: { client: SupabaseClient; userId: string };

function worldRevision(world: WorldStateRow): number {
  const revision = world.revision ?? -1;
  if (typeof revision !== "number" || !Number.isInteger(revision)) throw new Error("invalid test world revision");
  return revision;
}

function assertWorld(value: unknown): WorldStateRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid test world state");
  return value as WorldStateRow;
}

async function currentWorld(attemptId: string): Promise<WorldStateRow> {
  const { data, error } = await admin.from("attempt_state").select("world_state").eq("attempt_id", attemptId).single<{ world_state: unknown }>();
  if (error) throw error;
  return assertWorld(data.world_state);
}

async function seedAttempt(label: string): Promise<Seeded> {
  const { data: adventure, error: adventureError } = await admin.from("adventure").insert({ owner_id: teacher.userId, title: `Atomic ${label}`, default_timer_seconds: 600 }).select("id, share_token").single();
  if (adventureError) throw adventureError;
  const { data: version, error: versionError } = await admin.from("spec_version").insert({ adventure_id: adventure.id, version: 1, json: {}, generator_version: "test" }).select("id").single();
  if (versionError) throw versionError;
  const stageIds: string[] = [];
  const roomIds: string[] = [];
  for (const index of [0, 1]) {
    const { data: stage, error: stageError } = await admin.from("stage").insert({ spec_version_id: version.id, index, title: `Stage ${index}`, shared_context: `Context ${index}` }).select("id").single();
    if (stageError) throw stageError;
    stageIds.push(stage.id);
    const { data: room, error: roomError } = await admin.from("room").insert({ stage_id: stage.id, name: `Room ${index}` }).select("id").single();
    if (roomError) throw roomError;
    roomIds.push(room.id);
  }
  const { error: publishError } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure.id });
  if (publishError) throw publishError;
  const { data: joined, error: joinError } = await student.client.rpc("join_adventure", { p_token: adventure.share_token });
  if (joinError) throw joinError;
  return { attemptId: joined as string, stageIds: [stageIds[0]!, stageIds[1]!], roomIds: [roomIds[0]!, roomIds[1]!] };
}

function snapshot(revision: number, world: Record<string, unknown> = {}): Record<string, unknown> {
  return { world, journal: [], revision, playerPos: null, stageIndex: 0 };
}

function message(roomId: string, authorId: string, body: string) {
  return { room_id: roomId, author_type: "player", author_id: authorId, body, visibility: "room", created_at: new Date().toISOString() };
}

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("atomic-teacher"));
  student = await createUserClient(uniqueEmail("atomic-student"));
  otherStudent = await createUserClient(uniqueEmail("atomic-other"));
});

describe("atomic save_play_state", () => {
  it("restricts private reads, permits own public columns, and denies the authenticated RPC", async () => {
    const seeded = await seedAttempt("privacy");
    const privateRead = await student.client.from("attempt_state").select("world_state").eq("attempt_id", seeded.attemptId);
    expect(privateRead.error).not.toBeNull();
    expect(privateRead.data).toBeNull();
    const ownPublic = await student.client.from("attempt_state").select("journal, player_pos, updated_at").eq("attempt_id", seeded.attemptId).maybeSingle();
    expect(ownPublic.error).toBeNull();
    expect(ownPublic.data).not.toBeNull();
    const otherPublic = await otherStudent.client.from("attempt_state").select("journal, player_pos, updated_at").eq("attempt_id", seeded.attemptId);
    expect(otherPublic.error).toBeNull();
    expect(otherPublic.data).toEqual([]);
    const serviceRead = await admin.from("attempt_state").select("world_state").eq("attempt_id", seeded.attemptId).single();
    expect(serviceRead.error).toBeNull();
    expect(serviceRead.data?.world_state).toBeTruthy();
    const denied = await student.client.rpc("save_play_state", { p_attempt_id: seeded.attemptId, p_student_id: student.userId, p_expected_revision: 0, p_snapshot: snapshot(1), p_messages: [], p_decisions: [], p_resolution: null, p_opened_stage_id: null, p_ending_id: null });
    expect(denied.error).not.toBeNull();
  });

  it("allows one compare-and-swap writer and stores only its nested winner/message", async () => {
    const seeded = await seedAttempt("cas");
    const current = await currentWorld(seeded.attemptId);
    const expected = worldRevision(current);
    const args = (winner: "a" | "b") => ({ p_attempt_id: seeded.attemptId, p_student_id: student.userId, p_expected_revision: expected, p_snapshot: snapshot(expected + 1, { winner }), p_messages: [message(seeded.roomIds[0], student.userId, `winner-${winner}`)], p_decisions: [], p_resolution: null, p_opened_stage_id: null, p_ending_id: null });
    const results = await Promise.all([admin.rpc("save_play_state", args("a")), admin.rpc("save_play_state", args("b"))]);
    expect(results.filter(({ error }) => error === null)).toHaveLength(1);
    expect(results.filter(({ error }) => error?.code === "40001")).toHaveLength(1);
    const stored = await currentWorld(seeded.attemptId);
    const winner = (stored.world?.winner === "a" || stored.world?.winner === "b") ? stored.world.winner : null;
    expect(winner).not.toBeNull();
    const rows = await admin.from("message").select("body").eq("attempt_id", seeded.attemptId);
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([{ body: `winner-${winner}` }]);
  });

  it("rolls back invalid resolution, opened stage, ending, and wrong-student writes", async () => {
    const seeded = await seedAttempt("rollback");
    const before = await currentWorld(seeded.attemptId);
    const counts = async () => ({
      messages: (await admin.from("message").select("id").eq("attempt_id", seeded.attemptId)).data?.length ?? 0,
      commitments: (await admin.from("stage_commitment").select("id").eq("attempt_id", seeded.attemptId)).data?.length ?? 0,
      resolutions: (await admin.from("resolution").select("id").eq("attempt_id", seeded.attemptId)).data?.length ?? 0,
    });
    const beforeCounts = await counts();
    const invalidResolution = await admin.rpc("save_play_state", { p_attempt_id: seeded.attemptId, p_student_id: student.userId, p_expected_revision: worldRevision(before), p_snapshot: snapshot(worldRevision(before) + 1), p_messages: [message(seeded.roomIds[0], student.userId, "must rollback")], p_decisions: [{ stage_id: seeded.stageIds[0], actor_kind: "player", player_id: student.userId, agent_id: null, option_id: null }], p_resolution: { stage_id: randomUUID(), actions: {}, outcome: {}, rolls: [] }, p_opened_stage_id: null, p_ending_id: null });
    expect(invalidResolution.error).not.toBeNull();
    expect(await currentWorld(seeded.attemptId)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    const invalidStage = await admin.rpc("save_play_state", { p_attempt_id: seeded.attemptId, p_student_id: student.userId, p_expected_revision: worldRevision(before), p_snapshot: snapshot(worldRevision(before) + 1), p_messages: [], p_decisions: [], p_resolution: null, p_opened_stage_id: randomUUID(), p_ending_id: null });
    expect(invalidStage.error?.code).toBe("22023");
    const invalidEnding = await admin.rpc("save_play_state", { p_attempt_id: seeded.attemptId, p_student_id: student.userId, p_expected_revision: worldRevision(before), p_snapshot: snapshot(worldRevision(before) + 1), p_messages: [message(seeded.roomIds[0], student.userId, "invalid ending rollback")], p_decisions: [], p_resolution: null, p_opened_stage_id: null, p_ending_id: "missing-ending" });
    expect(invalidEnding.error?.code).toBe("22023");
    const wrongStudent = await admin.rpc("save_play_state", { p_attempt_id: seeded.attemptId, p_student_id: otherStudent.userId, p_expected_revision: worldRevision(before), p_snapshot: snapshot(worldRevision(before) + 1), p_messages: [], p_decisions: [], p_resolution: null, p_opened_stage_id: null, p_ending_id: null });
    expect(wrongStudent.error).not.toBeNull();
    expect(await currentWorld(seeded.attemptId)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("commits transition state atomically and repeats the exact args as a conflict", async () => {
    const seeded = await seedAttempt("transition");
    const before = await currentWorld(seeded.attemptId);
    const args = { p_attempt_id: seeded.attemptId, p_student_id: student.userId, p_expected_revision: worldRevision(before), p_snapshot: { ...snapshot(worldRevision(before) + 1, { transition: true }), stageIndex: 1 }, p_messages: [message(seeded.roomIds[0], student.userId, "transaction message")], p_decisions: [{ stage_id: seeded.stageIds[0], actor_kind: "player", player_id: student.userId, agent_id: null, option_id: null }], p_resolution: { stage_id: seeded.stageIds[0], actions: {}, outcome: { announcement: "resolved" }, rolls: [] }, p_opened_stage_id: seeded.stageIds[1], p_ending_id: null };
    const result = await admin.rpc("save_play_state", args);
    expect(result.error).toBeNull();
    const attempt = await admin.from("attempt").select("current_stage_id, stage_deadline_at").eq("id", seeded.attemptId).single();
    expect(attempt.error).toBeNull();
    expect(attempt.data?.current_stage_id).toBe(seeded.stageIds[1]);
    expect(result.data as string | null).toBe(attempt.data?.stage_deadline_at ?? null);
    expect((await admin.from("message").select("id").eq("attempt_id", seeded.attemptId)).data).toHaveLength(1);
    expect((await admin.from("stage_commitment").select("id").eq("attempt_id", seeded.attemptId)).data).toHaveLength(1);
    expect((await admin.from("resolution").select("id").eq("attempt_id", seeded.attemptId)).data).toHaveLength(1);
    const repeated = await admin.rpc("save_play_state", args);
    expect(repeated.error?.code).toBe("40001");
    expect((await admin.from("message").select("id").eq("attempt_id", seeded.attemptId)).data).toHaveLength(1);
  });
});
