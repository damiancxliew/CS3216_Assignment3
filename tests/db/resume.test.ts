/**
 * P7 — persistence and resume (FR-18). Validation: kill the tab mid-stage,
 * resume, same state. A "tab kill" is modelled the only way it is observable
 * from the server — a second, independent read — so what these tests really
 * assert is that the read is repeatable, that nothing about it moves the
 * deadline, and that it stays inside the same public projection and RLS
 * boundary as every other client path (FR-21).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { loadResumeState } from "@/lib/attempts/resume";
import { findForbiddenKeys } from "@/lib/turn-api/contract";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };

type Seeded = { attemptId: string; stageIds: string[]; roomId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("p7-teacher"));
  student = await createUserClient(uniqueEmail("p7-student"));
});

/** A published two-stage adventure the student has already joined. */
async function seedAttempt(): Promise<Seeded> {
  const { data: adventure } = await admin
    .from("adventure")
    .insert({
      owner_id: teacher.userId,
      title: "The Treaty",
      default_timer_seconds: 600,
    })
    .select("id, share_token")
    .single();

  const { data: version } = await admin
    .from("spec_version")
    .insert({
      adventure_id: adventure!.id,
      version: 1,
      json: {},
      generator_version: "test",
    })
    .select("id")
    .single();

  const stageIds: string[] = [];
  for (const index of [0, 1]) {
    const { data: stage } = await admin
      .from("stage")
      .insert({
        spec_version_id: version!.id,
        index,
        title: `Stage ${index}`,
        shared_context: `What everyone knows at stage ${index}`,
      })
      .select("id")
      .single();
    stageIds.push(stage!.id as string);
  }

  const { data: room } = await admin
    .from("room")
    .insert({ stage_id: stageIds[0], name: "Council chamber" })
    .select("id")
    .single();

  const { error: publishError } = await teacher.client.rpc("publish_adventure", {
    p_adventure_id: adventure!.id,
  });
  if (publishError) throw publishError;

  const { data: attemptId, error } = await student.client.rpc("join_adventure", {
    p_token: adventure!.share_token,
  });
  if (error) throw error;

  return {
    attemptId: attemptId as string,
    stageIds,
    roomId: room!.id as string,
  };
}

/** Progress the student would lose if anything lived only in the tab. */
async function playALittle({ attemptId, roomId }: Seeded) {
  await admin
    .from("attempt_state")
    .update({
      journal: [
        {
          id: "j1",
          text: "The envoy arrived three days before the signing.",
          sourceSpan: "Dispatch of 14 March, p.2",
          collectedAt: new Date().toISOString(),
        },
      ],
      player_pos: { x: 4, y: 7 },
    })
    .eq("attempt_id", attemptId);

  await admin.from("message").insert([
    {
      attempt_id: attemptId,
      room_id: roomId,
      author_type: "player",
      author_id: student.userId,
      body: "What terms are actually on the table?",
      visibility: "room",
    },
    {
      attempt_id: attemptId,
      room_id: roomId,
      author_type: "agent",
      body: "Fewer than you have been told.",
      visibility: "private",
    },
  ]);
}

describe("resume", () => {
  it("returns the same state on a second, independent read", async () => {
    const seeded = await seedAttempt();
    await playALittle(seeded);

    const first = await loadResumeState(student.client, seeded.attemptId);
    const reopened = await loadResumeState(student.client, seeded.attemptId);

    expect(first).not.toBeNull();
    expect(reopened!.stage).toEqual(first!.stage);
    expect(reopened!.journal).toEqual(first!.journal);
    expect(reopened!.transcript).toEqual(first!.transcript);
    expect(reopened!.playerPos).toEqual({ x: 4, y: 7 });
    expect(reopened!.timer.deadlineAt).toBe(first!.timer.deadlineAt);
  });

  it("recaps where the student was", async () => {
    const seeded = await seedAttempt();
    await playALittle(seeded);

    const state = await loadResumeState(student.client, seeded.attemptId);

    expect(state!.recap.join(" ")).toContain("stage 1 of 2");
    expect(state!.recap.join(" ")).toContain("envoy arrived");
    expect(state!.stage!.sharedContext).toBe("What everyone knows at stage 0");
  });

  it("carries the stage the orchestrator moved them to, not the one they joined on", async () => {
    const seeded = await seedAttempt();
    await admin.rpc("start_stage_deadline", {
      p_attempt_id: seeded.attemptId,
      p_stage_id: seeded.stageIds[1],
    });

    const state = await loadResumeState(student.client, seeded.attemptId);
    expect(state!.stage!.id).toBe(seeded.stageIds[1]);
    expect(state!.recap.join(" ")).toContain("stage 2 of 2");
  });

  it("does not extend the deadline by resuming", async () => {
    const seeded = await seedAttempt();
    const before = await loadResumeState(student.client, seeded.attemptId);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await loadResumeState(student.client, seeded.attemptId);

    expect(after!.timer.deadlineAt).toBe(before!.timer.deadlineAt);
    // The clock the countdown is measured against is the server's, and it moved.
    expect(new Date(after!.timer.serverNow).getTime()).toBeGreaterThan(
      new Date(before!.timer.serverNow).getTime(),
    );
  });

  it("withholds private traffic and every forbidden key", async () => {
    const seeded = await seedAttempt();
    await playALittle(seeded);

    const state = await loadResumeState(student.client, seeded.attemptId);

    expect(state!.transcript.map((m) => m.body)).toEqual([
      "What terms are actually on the table?",
    ]);
    expect(findForbiddenKeys(state)).toEqual([]);
  });

  it("is nothing at all for another student", async () => {
    const seeded = await seedAttempt();
    const intruder = await createUserClient(uniqueEmail("p7-intruder"));

    expect(await loadResumeState(intruder.client, seeded.attemptId)).toBeNull();
  });

  it("is readable by the teacher who owns the adventure", async () => {
    const seeded = await seedAttempt();
    await playALittle(seeded);

    const state = await loadResumeState(teacher.client, seeded.attemptId);
    expect(state!.journal).toHaveLength(1);
  });
});
