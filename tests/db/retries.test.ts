/**
 * Retries. Whether a finished attempt can be followed by a fresh one is the
 * teacher's setting on the adventure, and the database is where it holds: the
 * share link and the ending's "play it again" button both go through RPCs that
 * read it, and a live attempt resumes either way.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, prepareVersionMaps, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

type Seeded = { id: string; token: string; stageId: string };

async function seedPublished(teacherId: string, allowRetries: boolean): Promise<Seeded> {
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({
      owner_id: teacherId,
      title: allowRetries ? "Second chances" : "One shot",
      setting: "1819",
      status: "published",
      published_version: 1,
      default_timer_seconds: 600,
      allow_retries: allowRetries,
    })
    .select("id, share_token")
    .single();
  if (error) throw error;

  const { data: specVersion, error: specError } = await admin
    .from("spec_version")
    .insert({ adventure_id: adventure.id, version: 1, json: { stages: [] }, generator_version: "test" })
    .select("id")
    .single();
  if (specError) throw specError;

  const { data: stage, error: stageError } = await admin
    .from("stage")
    .insert({ spec_version_id: specVersion.id, index: 0, title: "The landing" })
    .select("id")
    .single();
  if (stageError) throw stageError;

  await prepareVersionMaps(admin, specVersion.id);
  const { error: publishError } = await admin
    .from("spec_version")
    .update({ published_at: new Date().toISOString() })
    .eq("id", specVersion.id);
  if (publishError) throw publishError;

  return { id: adventure.id, token: adventure.share_token, stageId: stage.id };
}

async function finish(attemptId: string): Promise<void> {
  const { error } = await admin.from("attempt").update({ status: "completed" }).eq("id", attemptId);
  if (error) throw error;
}

let student: SupabaseClient;
let studentId: string;
let stranger: SupabaseClient;
let retriesOn: Seeded;
let retriesOff: Seeded;

beforeAll(async () => {
  const t = await createUserClient(uniqueEmail("retries-teacher"));
  const s = await createUserClient(uniqueEmail("retries-student"));
  const x = await createUserClient(uniqueEmail("retries-stranger"));
  student = s.client;
  studentId = s.userId;
  stranger = x.client;

  retriesOn = await seedPublished(t.userId, true);
  retriesOff = await seedPublished(t.userId, false);
});

describe("allow_retries", () => {
  it("defaults to on, so adventures written before the setting existed keep behaving as they did", async () => {
    const { data } = await admin
      .from("adventure")
      .select("allow_retries")
      .eq("id", retriesOn.id)
      .single();
    expect(data?.allow_retries).toBe(true);
  });
});

describe("join_adventure with retries off", () => {
  it("hands back the finished attempt rather than opening a second one", async () => {
    const first = await student.rpc("join_adventure", { p_token: retriesOff.token });
    expect(first.error).toBeNull();
    await finish(first.data as string);

    const again = await student.rpc("join_adventure", { p_token: retriesOff.token });
    expect(again.error).toBeNull();
    expect(again.data).toBe(first.data);

    const { data: attempts } = await admin
      .from("attempt")
      .select("id")
      .eq("adventure_id", retriesOff.id)
      .eq("student_id", studentId);
    expect(attempts ?? []).toHaveLength(1);
  });
});

describe("restart_attempt", () => {
  it("starts a fresh attempt at the first stage when the teacher allows it", async () => {
    const joined = await student.rpc("join_adventure", { p_token: retriesOn.token });
    expect(joined.error).toBeNull();
    await finish(joined.data as string);

    const { data: retried, error } = await student.rpc("restart_attempt", {
      p_attempt_id: joined.data,
    });
    expect(error).toBeNull();
    expect(retried).not.toBe(joined.data);

    const { data: attempt } = await admin
      .from("attempt")
      .select("adventure_id, student_id, status, published_version, current_stage_id, stage_deadline_at")
      .eq("id", retried)
      .single();
    expect(attempt).toMatchObject({
      adventure_id: retriesOn.id,
      student_id: studentId,
      status: "active",
      published_version: 1,
      current_stage_id: retriesOn.stageId,
    });
    expect(attempt?.stage_deadline_at).not.toBeNull();

    // The new attempt starts empty rather than inheriting the finished one's journal.
    const { data: state } = await admin
      .from("attempt_state")
      .select("attempt_id")
      .eq("attempt_id", retried)
      .maybeSingle();
    expect(state).not.toBeNull();
  });

  it("returns the live attempt untouched instead of abandoning it", async () => {
    const live = await student.rpc("join_adventure", { p_token: retriesOn.token });
    expect(live.error).toBeNull();

    const { data: retried, error } = await student.rpc("restart_attempt", {
      p_attempt_id: live.data,
    });
    expect(error).toBeNull();
    expect(retried).toBe(live.data);
  });

  it("refuses when the teacher has switched retries off", async () => {
    const { data: finished } = await admin
      .from("attempt")
      .select("id")
      .eq("adventure_id", retriesOff.id)
      .eq("student_id", studentId)
      .limit(1)
      .single();

    const { error } = await student.rpc("restart_attempt", { p_attempt_id: finished!.id });
    expect(error).not.toBeNull();

    const { data: attempts } = await admin
      .from("attempt")
      .select("id")
      .eq("adventure_id", retriesOff.id)
      .eq("student_id", studentId);
    expect(attempts ?? []).toHaveLength(1);
  });

  it("refuses someone else's attempt", async () => {
    const { data: mine } = await admin
      .from("attempt")
      .select("id")
      .eq("adventure_id", retriesOn.id)
      .eq("student_id", studentId)
      .limit(1)
      .single();

    const { error } = await stranger.rpc("restart_attempt", { p_attempt_id: mine!.id });
    expect(error).not.toBeNull();
  });
});
