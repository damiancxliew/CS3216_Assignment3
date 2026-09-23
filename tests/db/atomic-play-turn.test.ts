import { loadFixtureJson, I1_FIXTURE, loadI1Spec } from "@adventure/generation/fixtures";
import { PlaySession } from "@/lib/play/session";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import { persistSpecVersion } from "@/lib/adventures/persist-spec";

const admin = serviceClient();
let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };
let spec: Awaited<ReturnType<typeof loadI1Spec>>;

type Seeded = { attemptId: string; adventureId: string; stageIds: string[]; roomId: string; optionId: string; mintedSpecId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("atomic-turn-teacher"));
  student = await createUserClient(uniqueEmail("atomic-turn-student"));
  spec = await loadI1Spec();
});

async function seed(): Promise<Seeded> {
  const { data: adventure, error: adventureError } = await admin.from("adventure").insert({ owner_id: teacher.userId, title: "Atomic turn", default_timer_seconds: 600 }).select("id, share_token").single();
  if (adventureError) throw adventureError;
  const persisted = await persistSpecVersion(admin, adventure.id, await loadFixtureJson(I1_FIXTURE.spec), { generatorVersion: "test", createdBy: teacher.userId });
  const { error: publishError } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure.id });
  if (publishError) throw publishError;
  const { data: attemptId, error: joinError } = await student.client.rpc("join_adventure", { p_token: adventure.share_token });
  if (joinError) throw joinError;
  const { data: stages, error: stageError } = await admin.from("stage").select("id, index, spec_id").eq("spec_version_id", persisted.specVersionId).order("index");
  if (stageError) throw stageError;
  const { data: rooms, error: roomError } = await admin.from("room").select("id, stage_id").eq("stage_id", stages![0]!.id).limit(1);
  if (roomError) throw roomError;
  const { data: options, error: optionError } = await admin.from("decision_option").select("id").eq("stage_id", stages![0]!.id).limit(1);
  if (optionError) throw optionError;
  const mintedSpecId = `minted-atomic-${attemptId}`;
  const { error: mintedError } = await admin.from("minted_option").insert({
    attempt_id: attemptId,
    stage_id: stages![0]!.id,
    spec_id: mintedSpecId,
    label: "Offer a temporary anchorage",
    preconditions: [{ kind: "actor_in_room", actorId: "player", roomId: "landing-beach" }],
    branch_target: stages![1]!.id,
  });
  if (mintedError) throw mintedError;
  return {
    attemptId: attemptId as string,
    adventureId: adventure.id,
    stageIds: stages!.map((stage) => stage.id),
    roomId: rooms![0]!.id,
    optionId: options![0]!.id,
    mintedSpecId,
  };
}

function message(attemptId: string, roomId: string, body: string) {
  return { runtime_id: `${attemptId}:message:${body}`, room_id: roomId, author_type: "player", author_id: student.userId, body, visibility: "room", created_at: new Date().toISOString() };
}

function snapshot(attemptId: string, revision: number, stageIndex = 0, status: "active" | "completed" = "active") {
  return PlaySession.start(spec, attemptId, 1).snapshot() as Record<string, unknown>;
}

function withRevision(base: Record<string, unknown>, revision: number, stageIndex = 0, status: "active" | "completed" = "active", endingId: string | null = null) {
  return { ...base, revision, stageIndex, status, endingId };
}

function errorCode(result: { error: { code?: string } | null }) {
  return result.error?.code ?? null;
}

describe("save_play_turn", () => {
  it("allows exactly one concurrent revision-zero writer and persists its sole message", async () => {
    const seeded = await seed();
    const base = snapshot(seeded.attemptId, 0);
    const firstSnapshot = withRevision(base, 1);
    const secondSnapshot = withRevision(base, 1);
    const args = (body: string, snap: Record<string, unknown>) => ({ p_attempt_id: seeded.attemptId, p_expected_revision: 0, p_stage_spec_id: "stage-landing", p_snapshot: snap, p_messages: [message(seeded.attemptId, seeded.roomId, body)], p_commitments: [], p_resolution: null, p_telemetry: null, p_opened_stage_id: null, p_ending_id: null });
    const results = await Promise.all([admin.rpc("save_play_turn", args("writer-a", firstSnapshot)), admin.rpc("save_play_turn", args("writer-b", secondSnapshot))]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => errorCode(result) === "40001")).toHaveLength(1);
    const winner = results[0]!.error === null ? firstSnapshot : secondSnapshot;
    const runtime = (await admin.from("attempt_runtime").select("revision, snapshot").eq("attempt_id", seeded.attemptId).single()).data!;
    expect(runtime.revision).toBe(1);
    expect(runtime.snapshot).toEqual(winner);
    const rows = (await admin.from("message").select("body").eq("attempt_id", seeded.attemptId)).data!;
    expect(rows).toEqual([{ body: results[0]!.error === null ? "writer-a" : "writer-b" }]);
  });

  it("rolls back all writes for invalid telemetry and invalid ending payloads", async () => {
    const seeded = await seed();
    const base = snapshot(seeded.attemptId, 0);
    const writes = { p_attempt_id: seeded.attemptId, p_expected_revision: 0, p_stage_spec_id: "stage-landing", p_snapshot: withRevision(base, 1), p_messages: [message(seeded.attemptId, seeded.roomId, "rollback")], p_commitments: [{ stage_id: seeded.stageIds[0], actor_kind: "player", player_id: student.userId, agent_id: null, option_id: seeded.optionId }], p_resolution: { stage_id: seeded.stageIds[0], actions: [], outcome: { announcement: "resolved" }, rolls: [] }, p_telemetry: { stage_id: randomUUID(), stage_index: 0, ended_by: "decision", duration_seconds: 1, tokens: 1, messages: 1, actions: 1, evidence_found: 0, agent_lines: 0 }, p_opened_stage_id: null, p_ending_id: null };
    const invalidTelemetry = await admin.rpc("save_play_turn", writes);
    expect(errorCode(invalidTelemetry)).toBe("22023");
    expect((await admin.from("attempt_runtime").select("attempt_id").eq("attempt_id", seeded.attemptId)).data).toEqual([]);
    expect((await admin.from("message").select("id").eq("attempt_id", seeded.attemptId)).data).toEqual([]);
    expect((await admin.from("stage_commitment").select("id").eq("attempt_id", seeded.attemptId)).data).toEqual([]);
    expect((await admin.from("resolution").select("id").eq("attempt_id", seeded.attemptId)).data).toEqual([]);
    expect((await admin.from("attempt_telemetry").select("id").eq("attempt_id", seeded.attemptId)).data).toEqual([]);
    const publicBefore = (await admin.from("attempt_state").select("world_state, journal, player_pos").eq("attempt_id", seeded.attemptId).single()).data;
    const invalidEnding = await admin.rpc("save_play_turn", { ...writes, p_telemetry: null, p_snapshot: withRevision(base, 1, 0, "completed", "not-an-ending"), p_messages: [], p_commitments: [], p_resolution: null, p_ending_id: "not-an-ending" });
    expect(errorCode(invalidEnding)).toBe("22023");
    const publicAfter = (await admin.from("attempt_state").select("world_state, journal, player_pos").eq("attempt_id", seeded.attemptId).single()).data;
    expect(publicAfter).toEqual(publicBefore);
  });

  it("persists a same-turn minted commitment and rejects mixed authored/minted choices", async () => {
    const seeded = await seed();
    const base = snapshot(seeded.attemptId, 0);
    const mintedSpecId = `minted-rpc-${seeded.attemptId}`;
    const mintedPayload = {
      stage_id: seeded.stageIds[0],
      spec_id: mintedSpecId,
      label: "Open a second channel",
      preconditions: [{ kind: "actor_in_room", actorId: "player", roomId: "landing-beach" }],
      branch_target: seeded.stageIds[1],
    };
    const mintedWrite = await admin.rpc("save_play_turn", {
      p_attempt_id: seeded.attemptId,
      p_expected_revision: 0,
      p_stage_spec_id: "stage-landing",
      p_snapshot: withRevision(base, 1),
      p_messages: [],
      p_commitments: [{
        stage_id: seeded.stageIds[0],
        actor_kind: "player",
        player_id: student.userId,
        agent_id: null,
        option_id: null,
        minted_spec_id: mintedSpecId,
      }],
      p_resolution: null,
      p_telemetry: null,
      p_opened_stage_id: null,
      p_ending_id: null,
      p_minted_options: [mintedPayload],
    });
    expect(mintedWrite.error).toBeNull();
    const mintedRow = (await admin
      .from("minted_option")
      .select("id")
      .eq("attempt_id", seeded.attemptId)
      .eq("spec_id", mintedSpecId)
      .single()).data;
    expect(mintedRow).not.toBeNull();
    const commitment = (await admin
      .from("stage_commitment")
      .select("option_id, minted_option_id")
      .eq("attempt_id", seeded.attemptId)
      .single()).data;
    expect(commitment).toEqual({ option_id: null, minted_option_id: mintedRow!.id });

    const mixed = await admin.rpc("save_play_turn", {
      p_attempt_id: seeded.attemptId,
      p_expected_revision: 1,
      p_stage_spec_id: "stage-landing",
      p_snapshot: withRevision(base, 3),
      p_messages: [],
      p_commitments: [{
        stage_id: seeded.stageIds[0],
        actor_kind: "player",
        player_id: student.userId,
        agent_id: null,
        option_id: seeded.optionId,
        minted_spec_id: mintedSpecId,
      }],
      p_resolution: null,
      p_telemetry: null,
      p_opened_stage_id: null,
      p_ending_id: null,
    });
    expect(errorCode(mixed)).toBe("22023");
  });

  it("rejects minted commitments from another attempt or another stage", async () => {
    const owner = await seed();
    const other = await seed();
    const base = snapshot(owner.attemptId, 0);
    const wrongAttempt = await admin.rpc("save_play_turn", {
      p_attempt_id: owner.attemptId,
      p_expected_revision: 0,
      p_stage_spec_id: "stage-landing",
      p_snapshot: withRevision(base, 1),
      p_messages: [],
      p_commitments: [{
        stage_id: owner.stageIds[0],
        actor_kind: "player",
        player_id: student.userId,
        agent_id: null,
        option_id: null,
        minted_spec_id: other.mintedSpecId,
      }],
      p_resolution: null,
      p_telemetry: null,
      p_opened_stage_id: null,
      p_ending_id: null,
    });
    expect(errorCode(wrongAttempt)).toBe("22023");

    const wrongStage = await admin.from("minted_option").insert({
      attempt_id: owner.attemptId,
      stage_id: owner.stageIds[1],
      spec_id: `minted-atomic-stage-${owner.attemptId}`,
      label: "Open a second channel",
      preconditions: [],
      branch_target: null,
    }).select("id").single();
    expect(wrongStage.error).toBeNull();
    const wrongStageCommitment = await admin.rpc("save_play_turn", {
      p_attempt_id: owner.attemptId,
      p_expected_revision: 0,
      p_stage_spec_id: "stage-landing",
      p_snapshot: withRevision(base, 1),
      p_messages: [],
      p_commitments: [{
        stage_id: owner.stageIds[0],
        actor_kind: "player",
        player_id: student.userId,
        agent_id: null,
        option_id: null,
        minted_spec_id: `minted-atomic-stage-${owner.attemptId}`,
      }],
      p_resolution: null,
      p_telemetry: null,
      p_opened_stage_id: null,
      p_ending_id: null,
    });
    expect(errorCode(wrongStageCommitment)).toBe("22023");
  });

  it("commits initial and stage-transition saves, then rejects an old revision without duplicates", async () => {
    const seeded = await seed();
    const base = snapshot(seeded.attemptId, 0);
    const initialArgs = { p_attempt_id: seeded.attemptId, p_expected_revision: 0, p_stage_spec_id: "stage-landing", p_snapshot: withRevision(base, 1), p_messages: [message(seeded.attemptId, seeded.roomId, "initial")], p_commitments: [], p_resolution: null, p_telemetry: null, p_opened_stage_id: null, p_ending_id: null };
    const initial = await admin.rpc("save_play_turn", initialArgs);
    expect(initial.error).toBeNull();
    expect((initial.data as { runtimeRevision: number }).runtimeRevision).toBe(1);
    const transitioned = { ...initialArgs, p_expected_revision: 1, p_stage_spec_id: "stage-sultan", p_snapshot: withRevision(base, 2, 1), p_messages: [message(seeded.attemptId, seeded.roomId, "transition")], p_opened_stage_id: seeded.stageIds[1] };
    const next = await admin.rpc("save_play_turn", transitioned);
    expect(next.error).toBeNull();
    expect((next.data as { runtimeRevision: number }).runtimeRevision).toBe(2);
    const attempt = (await admin.from("attempt").select("current_stage_id, stage_deadline_at").eq("id", seeded.attemptId).single()).data!;
    expect(attempt.current_stage_id).toBe(seeded.stageIds[1]);
    expect((next.data as { stageDeadlineAt: string | null }).stageDeadlineAt).toBe(attempt.stage_deadline_at);
    const counts = async () => ({ messages: (await admin.from("message").select("id").eq("attempt_id", seeded.attemptId)).data!.length, runtime: (await admin.from("attempt_runtime").select("attempt_id").eq("attempt_id", seeded.attemptId)).data!.length });
    const before = await counts();
    const repeated = await admin.rpc("save_play_turn", initialArgs);
    expect(errorCode(repeated)).toBe("40001");
    expect(await counts()).toEqual(before);
    const denied = await student.client.rpc("save_play_turn", initialArgs);
    expect(denied.error).not.toBeNull();
    const hidden = await student.client.from("attempt_runtime").select("snapshot").eq("attempt_id", seeded.attemptId);
    expect(hidden.error).not.toBeNull();
    const publicMetadata = await student.client.from("attempt_state").select("journal, player_pos, updated_at").eq("attempt_id", seeded.attemptId).single();
    expect(publicMetadata.error).toBeNull();
    expect(publicMetadata.data).not.toBeNull();
  });
});
