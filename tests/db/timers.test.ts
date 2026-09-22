/**
 * P6 — stage timers (D12/FR-16). The settings are inheritance rules; the
 * enforcement is that the deadline lives on the server. What this proves: null
 * inherits the adventure default and 0 disables, the deadline is computed from
 * the database clock when a stage opens, re-reading (a refresh, a second tab)
 * buys no extra time, and once the deadline has passed the player's pass is
 * recorded — but not before, and not by someone else.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, prepareVersionMaps, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

type Seeded = {
  adventureId: string;
  stageIds: string[];
  /** One option on stage 0, inserted before publishing froze the version. */
  optionId: string;
  token: string;
};

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("p6-teacher"));
  student = await createUserClient(uniqueEmail("p6-student"));
});

/** Two stages, published, so a student can join and the timers are live. */
async function seed(defaultTimer: number): Promise<Seeded> {
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({
      owner_id: teacher.userId,
      title: "Timed",
      default_timer_seconds: defaultTimer,
    })
    .select("id, share_token")
    .single();
  if (error) throw error;

  const { data: version, error: versionError } = await admin
    .from("spec_version")
    .insert({
      adventure_id: adventure.id,
      version: 1,
      json: {},
      generator_version: "test",
    })
    .select("id")
    .single();
  if (versionError) throw versionError;

  const stageIds: string[] = [];
  for (const index of [0, 1]) {
    const { data: stage, error: stageError } = await admin
      .from("stage")
      .insert({ spec_version_id: version.id, index, title: `Stage ${index}` })
      .select("id")
      .single();
    if (stageError) throw stageError;
    stageIds.push(stage.id as string);
  }

  const { data: option, error: optionError } = await admin
    .from("decision_option")
    .insert({ stage_id: stageIds[0], label: "Sign the treaty" })
    .select("id")
    .single();
  if (optionError) throw optionError;

  await prepareVersionMaps(admin, version!.id);
  const { error: publishError } = await teacher.client.rpc("publish_adventure", {
    p_adventure_id: adventure.id,
  });
  if (publishError) throw publishError;

  return {
    adventureId: adventure.id as string,
    stageIds,
    optionId: option.id as string,
    token: adventure.share_token as string,
  };
}

async function deadlineOf(attemptId: string): Promise<string | null> {
  const { data } = await admin
    .from("attempt")
    .select("stage_deadline_at")
    .eq("id", attemptId)
    .single();
  return (data!.stage_deadline_at as string | null) ?? null;
}

describe("effective_timer_seconds", () => {
  it("inherits the adventure default when the stage does not override it", async () => {
    const { stageIds } = await seed(300);
    const { data } = await admin.rpc("effective_timer_seconds", {
      p_stage_id: stageIds[0],
    });
    expect(data).toBe(300);
  });

  it("lets a stage override the default, including down to 0", async () => {
    const { adventureId, stageIds } = await seed(300);
    // The version is published, so editing means a new draft (P4).
    await teacher.client.rpc("create_draft_version", { p_adventure_id: adventureId });
    const { data: draftStages } = await admin
      .from("stage")
      .select("id, index, spec_version_id, spec_version!inner(version)")
      .eq("spec_version.adventure_id", adventureId)
      .eq("spec_version.version", 2)
      .order("index");

    const first = draftStages![0].id as string;
    const second = draftStages![1].id as string;

    const override = await teacher.client.rpc("set_stage_timer", {
      p_stage_id: first,
      p_seconds: 60,
    });
    expect(override.error).toBeNull();
    const disabled = await teacher.client.rpc("set_stage_timer", {
      p_stage_id: second,
      p_seconds: 0,
    });
    expect(disabled.error).toBeNull();

    const { data: overridden } = await admin.rpc("effective_timer_seconds", {
      p_stage_id: first,
    });
    expect(overridden).toBe(60);
    const { data: off } = await admin.rpc("effective_timer_seconds", {
      p_stage_id: second,
    });
    expect(off).toBe(0);

    // Clearing the override falls back to inheritance.
    await teacher.client.rpc("set_stage_timer", { p_stage_id: first, p_seconds: null });
    const { data: inherited } = await admin.rpc("effective_timer_seconds", {
      p_stage_id: first,
    });
    expect(inherited).toBe(300);

    void stageIds;
  });

  it("refuses a timer change from another teacher and on a published version", async () => {
    const { adventureId, stageIds } = await seed(300);
    const intruder = await createUserClient(uniqueEmail("p6-intruder"));

    const asIntruder = await intruder.client.rpc("set_stage_timer", {
      p_stage_id: stageIds[0],
      p_seconds: 30,
    });
    expect(asIntruder.error).not.toBeNull();

    // Even the owner cannot edit a frozen version in place (P4).
    const asOwner = await teacher.client.rpc("set_stage_timer", {
      p_stage_id: stageIds[0],
      p_seconds: 30,
    });
    expect(asOwner.error?.message).toMatch(/published|immutable/i);

    void adventureId;
  });
});

describe("the deadline is server-held", () => {
  it("is stamped from the database clock when a stage opens", async () => {
    const { token } = await seed(120);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });

    const deadline = await deadlineOf(attemptId as string);
    const { data: serverNow } = await admin.rpc("server_now");
    const remaining = (new Date(deadline!).getTime() - new Date(serverNow as string).getTime()) / 1000;
    expect(remaining).toBeGreaterThan(110);
    expect(remaining).toBeLessThanOrEqual(120);
  });

  it("is null when the timer is disabled", async () => {
    const { token } = await seed(0);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });
    expect(await deadlineOf(attemptId as string)).toBeNull();
  });

  it("does not move when the student reopens the link", async () => {
    const { token } = await seed(120);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });
    const first = await deadlineOf(attemptId as string);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    // A refresh is another join: it must resume, not restart the clock.
    const { data: again } = await student.client.rpc("join_adventure", {
      p_token: token,
    });
    expect(again).toBe(attemptId);
    expect(await deadlineOf(attemptId as string)).toBe(first);
  });

  it("is restamped only when orchestration opens the next stage", async () => {
    const { token, stageIds } = await seed(120);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });
    const first = await deadlineOf(attemptId as string);

    const { data: next, error } = await admin.rpc("start_stage_deadline", {
      p_attempt_id: attemptId,
      p_stage_id: stageIds[1],
    });
    expect(error).toBeNull();
    expect(new Date(next as string).getTime()).toBeGreaterThan(
      new Date(first!).getTime(),
    );

    // And a student cannot do that for themselves.
    const asStudent = await student.client.rpc("start_stage_deadline", {
      p_attempt_id: attemptId,
      p_stage_id: stageIds[1],
    });
    expect(asStudent.error).not.toBeNull();
  });
});

describe("expire_stage_if_due", () => {
  async function joinExpired(secondsAgo: number): Promise<string> {
    const { token } = await seed(120);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });
    await admin
      .from("attempt")
      .update({
        stage_deadline_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
      })
      .eq("id", attemptId);
    return attemptId as string;
  }

  it("does nothing while time remains", async () => {
    const { token } = await seed(120);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });

    const { data: expired } = await student.client.rpc("expire_stage_if_due", {
      p_attempt_id: attemptId,
    });
    expect(expired).toBe(false);

    const { count } = await admin
      .from("stage_commitment")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", attemptId);
    expect(count).toBe(0);
  });

  it("records a pass once the deadline has passed, exactly once", async () => {
    const attemptId = await joinExpired(5);

    const first = await student.client.rpc("expire_stage_if_due", {
      p_attempt_id: attemptId,
    });
    expect(first.data).toBe(true);
    // A second tab, or a second poll, must not create a second commitment.
    await student.client.rpc("expire_stage_if_due", { p_attempt_id: attemptId });

    const { data: commitments } = await admin
      .from("stage_commitment")
      .select("actor_kind, player_id, option_id")
      .eq("attempt_id", attemptId);
    expect(commitments).toHaveLength(1);
    expect(commitments![0].actor_kind).toBe("player");
    expect(commitments![0].player_id).toBe(student.userId);
    expect(commitments![0].option_id).toBeNull();
  });

  it("keeps a decision made in time instead of overwriting it with a pass", async () => {
    const { token, stageIds, optionId } = await seed(120);
    const { data: attemptId } = await student.client.rpc("join_adventure", {
      p_token: token,
    });

    await admin.from("stage_commitment").insert({
      attempt_id: attemptId,
      stage_id: stageIds[0],
      actor_kind: "player",
      player_id: student.userId,
      option_id: optionId,
    });

    await admin
      .from("attempt")
      .update({ stage_deadline_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", attemptId);
    await student.client.rpc("expire_stage_if_due", { p_attempt_id: attemptId });

    const { data: commitments } = await admin
      .from("stage_commitment")
      .select("option_id")
      .eq("attempt_id", attemptId);
    expect(commitments).toHaveLength(1);
    expect(commitments![0].option_id).toBe(optionId);
  });

  it("refuses to expire someone else's attempt", async () => {
    const attemptId = await joinExpired(5);
    const intruder = await createUserClient(uniqueEmail("p6-other-student"));

    const { error } = await intruder.client.rpc("expire_stage_if_due", {
      p_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("stage_commitment")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", attemptId);
    expect(count).toBe(0);
  });
});
