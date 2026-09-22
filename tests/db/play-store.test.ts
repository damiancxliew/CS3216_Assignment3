/**
 * I3 over the platform schema: the Turn API's Supabase store. The I1 fixture is
 * persisted for real (P5), published (P4) and joined (P3); then the play
 * service runs against `SupabasePlayStore` with a fake model. What this proves:
 * the snapshot round-trips through `attempt_state`, what happened lands in
 * `message` / `stage_commitment` / `resolution` with slugs bound to row uuids,
 * a stage change restamps the server-held deadline (P6), an ending completes
 * the attempt (P8), and the resume view (P7) reads what the loop wrote.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { loadFixtureJson, I1_FIXTURE, loadI1Spec } from "@adventure/generation/fixtures";
import { FakeLlmClient } from "@adventure/orchestration";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { loadResumeState } from "@/lib/attempts/resume";
import { getState, postAction, postDecision, postMessage, type PlayServiceDeps } from "@/lib/play/service";
import { SupabasePlayStore } from "@/lib/play/store";
import { findForbiddenKeys } from "@/lib/turn-api/contract";

const admin = serviceClient();
const say = (line: string) => JSON.stringify({ say: line, actions: [] });

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };
let attemptId: string;
let adventureId: string;
let deps: PlayServiceDeps;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify((result as { error?: unknown }).error)}`);
  return result as Extract<T, { ok: true }>;
}

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("i3-teacher"));
  student = await createUserClient(uniqueEmail("i3-student"));

  const { data: adventure } = await admin
    .from("adventure")
    .insert({ owner_id: teacher.userId, title: "Singapore, 1819", default_timer_seconds: 600 })
    .select("id, share_token")
    .single();
  adventureId = adventure!.id as string;
  await persistSpecVersion(admin, adventureId, await loadFixtureJson(I1_FIXTURE.spec), { generatorVersion: "test", createdBy: teacher.userId });
  const { error: publishError } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventureId });
  if (publishError) throw publishError;
  const { data: joined, error } = await student.client.rpc("join_adventure", { p_token: adventure!.share_token });
  if (error) throw error;
  attemptId = joined as string;

  deps = { store: new SupabasePlayStore(admin), llm: new FakeLlmClient({ replies: Array(80).fill(say("The anchorage is not the Company's to name a price for.")) }) };
});

describe("SupabasePlayStore", () => {
  it("starts the attempt from the published spec and persists the snapshot", async () => {
    const result = ok(await getState(deps, attemptId, student.userId));
    const spec = await loadI1Spec();
    expect(result.state.stage.id).toBe(spec.stages[0]!.id);
    expect(result.state.timer.enabled).toBe(true); // join_adventure stamped the stage-0 deadline
    expect(result.state.timer.secondsRemaining).toBeGreaterThan(500);

    const { data: state } = await admin.from("attempt_state").select("world_state").eq("attempt_id", attemptId).single();
    expect(Object.keys(state!.world_state as Record<string, unknown>).sort()).toEqual([
      "endingId",
      "revision",
      "stageIndex",
      "status",
      "version",
    ]);
    expect((state!.world_state as { version: number; stageIndex: number }).version).toBe(1);
    expect((state!.world_state as { stageIndex: number }).stageIndex).toBe(0);
    expect(JSON.stringify(state!.world_state)).not.toContain("privateNotes");
    expect(JSON.stringify(state!.world_state)).not.toContain("privateContext");
    expect(JSON.stringify(state!.world_state)).not.toContain("rolls");
    expect(JSON.stringify(state!.world_state)).not.toContain("rationale");
    const { data: runtime } = await admin.from("attempt_runtime").select("revision, stage_spec_id, snapshot").eq("attempt_id", attemptId).single();
    expect(runtime!.revision).toBe(1);
    expect(runtime!.stage_spec_id).toBe("stage-landing");
    expect((runtime!.snapshot as { world: unknown }).world).toBeTruthy();
    const { data: studentRuntime } = await student.client.from("attempt_runtime").select("snapshot").eq("attempt_id", attemptId);
    expect(studentRuntime ?? []).toHaveLength(0);
  });

  it("is not playable by another student", async () => {
    const other = await createUserClient(uniqueEmail("i3-other"));
    expect(await getState(deps, attemptId, other.userId)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("records room talk as messages bound to the room row, and the resume view reads them back", async () => {
    const state = ok(await getState(deps, attemptId, student.userId)).state;
    const reply = ok(await postMessage(deps, attemptId, student.userId, { roomId: state.currentRoomId!, body: "What are your instructions?" }));
    expect(reply.value).toHaveLength(2);

    const { data: rows } = await admin.from("message").select("runtime_id, room_id, author_type, author_id, body, visibility").eq("attempt_id", attemptId).order("created_at");
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({ author_type: "player", author_id: student.userId, visibility: "room" });
    expect(rows![1]).toMatchObject({ author_type: "agent", visibility: "room" });
    expect(rows!.every((row) => row.runtime_id !== null)).toBe(true);
    expect(rows![0]!.room_id).not.toBeNull();
    const { data: room } = await admin.from("room").select("spec_id").eq("id", rows![0]!.room_id as string).single();
    expect(room!.spec_id).toBe(state.currentRoomId);
    expect(rows![1]!.author_id).not.toBeNull();

    const resumed = await loadResumeState(student.client, attemptId);
    expect(resumed!.transcript.map((m) => m.body)).toEqual(rows!.map((r) => r.body));
    expect(findForbiddenKeys(resumed)).toEqual([]);
  });

  it("rehydrates the same public state on an independent load (P7)", async () => {
    const a = ok(await getState(deps, attemptId, student.userId)).state;
    const b = ok(await getState({ ...deps, store: new SupabasePlayStore(admin) }, attemptId, student.userId)).state;
    expect(b.transcript).toEqual(a.transcript);
    expect(b.revision).toBe(a.revision);
    expect(b.currentRoomId).toBe(a.currentRoomId);
  });

  it("writes commitments and the resolution, restamps the deadline for the next stage, and completes at an ending", async () => {
    const spec = await loadI1Spec();
    // Examine what is reachable, then decide on whatever is available; expire the stage if nothing is.
    for (let guard = 0; guard < 6; guard += 1) {
      const state = ok(await getState(deps, attemptId, student.userId)).state;
      if (state.status === "completed") break;
      for (const item of spec.stages[state.stage.index]!.evidence) {
        const here = ok(await getState(deps, attemptId, student.userId)).state.currentRoomId;
        if (here !== item.roomId) {
          const moved = ok(await postAction(deps, attemptId, student.userId, { type: "move_room", toRoomId: item.roomId, position: { x: 2, y: 2 } }));
          if (moved.value.refused) continue;
        }
        await postAction(deps, attemptId, student.userId, { type: "inspect", evidenceId: item.id });
      }
      const ready = ok(await getState(deps, attemptId, student.userId)).state;
      const option = ready.options.find((o) => o.available);
      if (option) {
        const before = (await admin.from("attempt").select("stage_deadline_at, current_stage_id").eq("id", attemptId).single()).data!;
        const decided = ok(await postDecision(deps, attemptId, student.userId, { optionId: option.id, optionsVersion: ready.optionsVersion }));
        expect(decided.value.announcement.length).toBeGreaterThan(0);
        const after = (await admin.from("attempt").select("stage_deadline_at, current_stage_id, status").eq("id", attemptId).single()).data!;
        if (decided.state.status === "active") {
          expect(after.current_stage_id).not.toBe(before.current_stage_id); // P6: orchestration opened the next stage
          // The response reports the deadline the database now holds (a stage with timer 0 has none).
          expect(decided.state.timer.deadlineAt).toBe(after.stage_deadline_at);
          const timer = spec.stages[decided.state.stage.index]!.timerSeconds ?? spec.defaultTimerSeconds;
          expect(after.stage_deadline_at === null).toBe(timer === 0);
        }
      } else {
        // Time the stage out from the database side, as the real clock would.
        await admin.from("attempt").update({ stage_deadline_at: new Date(Date.now() - 1000).toISOString() }).eq("id", attemptId);
      }
    }

    const final = ok(await getState(deps, attemptId, student.userId)).state;
    expect(final.status).toBe("completed");

    const { data: attempt } = await admin.from("attempt").select("status, ending_id, current_stage_id, stage_deadline_at").eq("id", attemptId).single();
    expect(attempt).toMatchObject({ status: "completed", ending_id: final.ending!.id, current_stage_id: null, stage_deadline_at: null });

    const { data: commitments } = await admin.from("stage_commitment").select("actor_kind, player_id, agent_id, option_id").eq("attempt_id", attemptId);
    expect(commitments!.some((c) => c.actor_kind === "player" && c.player_id === student.userId)).toBe(true);
    expect(commitments!.some((c) => c.actor_kind === "agent" && c.agent_id !== null)).toBe(true);

    const { data: resolutions } = await admin.from("resolution").select("stage_id, actions, outcome, rolls").eq("attempt_id", attemptId).order("created_at");
    expect(resolutions!.length).toBeGreaterThanOrEqual(1);
    expect((resolutions![0]!.outcome as { announcement: string }).announcement.length).toBeGreaterThan(0);
    expect(Array.isArray(resolutions![0]!.rolls)).toBe(true);

    // The student can read that a resolution happened, never its rolls (FR-21).
    const { data: asStudent } = await student.client.from("resolution").select("id").eq("attempt_id", attemptId);
    expect(asStudent ?? []).toHaveLength(0);
  });
});
