import { loadI1Spec } from "@adventure/generation/fixtures";
import { beforeAll, describe, expect, it } from "vitest";

import { loadResumeState } from "@/lib/attempts/resume";
import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { SupabaseRuntimeStore } from "@/lib/turn-api/supabase-runtime";
import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

let student: Awaited<ReturnType<typeof createUserClient>>;
let teacher: Awaited<ReturnType<typeof createUserClient>>;
let attemptId: string;
let adventureId: string;
let specVersionId: string;

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("runtime-teacher"));
  student = await createUserClient(uniqueEmail("runtime-student"));
  const { data: adventure, error: adventureError } = await admin
    .from("adventure")
    .insert({ owner_id: teacher.userId, title: "Singapore runtime" })
    .select("id")
    .single();
  if (adventureError) throw adventureError;
  adventureId = adventure.id;

  const spec = await loadI1Spec();
  const persisted = await persistSpecVersion(admin, adventureId, spec, {
    generatorVersion: "runtime-test",
    createdBy: teacher.userId,
  });
  specVersionId = persisted.specVersionId;
  const published = await teacher.client.rpc("publish_adventure", {
    p_adventure_id: adventureId,
  });
  if (published.error) throw published.error;

  const { data: share, error: shareError } = await admin
    .from("adventure")
    .select("share_token")
    .eq("id", adventureId)
    .single();
  if (shareError) throw shareError;
  const joined = await student.client.rpc("join_adventure", { p_token: share.share_token });
  if (joined.error) throw joined.error;
  attemptId = joined.data as string;
});

describe("Supabase runtime integration", () => {
  it("initializes and persists a public runtime state", async () => {
    const store = new SupabaseRuntimeStore(student.client, admin);
    const state = await store.getState(attemptId);

    expect(state.adventureId).toBe(adventureId);
    expect(state.publishedVersion).toBe(1);
    expect(state.stage.id).toBe("stage-landing");

    const { data: runtime, error } = await admin
      .from("attempt_runtime")
      .select("attempt_id, revision, stage_spec_id")
      .eq("attempt_id", attemptId)
      .single();
    expect(error).toBeNull();
    expect(runtime).toMatchObject({ revision: 1, stage_spec_id: "stage-landing" });
  });

  it("persists public messages and restores them from a cold store", async () => {
    const store = new SupabaseRuntimeStore(student.client, admin);
    const posted = await store.postMessage(attemptId, "ship-cabin", "Show me the instructions.");
    expect(posted.ok).toBe(true);

    const { data: messages, error: messageError } = await admin
      .from("message")
      .select("runtime_id, room_id, author_type, author_id")
      .eq("attempt_id", attemptId);
    expect(messageError).toBeNull();
    expect(messages!.length).toBeGreaterThanOrEqual(2);
    expect(messages!.every((message) => message.runtime_id !== null)).toBe(true);
    expect(messages!.every((message) => message.room_id !== null)).toBe(true);

    const { data: publicState, error: stateError } = await admin
      .from("attempt_state")
      .select("world_state, journal")
      .eq("attempt_id", attemptId)
      .single();
    expect(stateError).toBeNull();
    const serialized = JSON.stringify(publicState!.world_state);
    expect(serialized).not.toContain("privateContext");
    expect(serialized).not.toContain("fears the Sultan in Riau will repudiate");
    expect(serialized).not.toContain("privateNotes");
    expect(serialized).not.toContain("rolls");
    expect(serialized).not.toContain("rationale");

    const restored = await new SupabaseRuntimeStore(student.client, admin).getState(attemptId);
    expect(restored.journal.map((entry) => entry.id)).toContain("ev-instructions");
    expect(restored.transcript.some((message) => message.body === "Show me the instructions.")).toBe(true);
  });

  it("persists commitments, resolution internals, and the next stage deadline", async () => {
    const result = await new SupabaseRuntimeStore(student.client, admin).commitDecision(
      attemptId,
      "opt-sign-preliminary",
    );
    expect(result?.resolution.nextStageId).toBe("stage-sultan");
    expect(result?.state.stage.id).toBe("stage-sultan");

    const { data: attempt, error: attemptError } = await admin
      .from("attempt")
      .select("current_stage_id, stage_deadline_at")
      .eq("id", attemptId)
      .single();
    expect(attemptError).toBeNull();
    expect(attempt.stage_deadline_at).not.toBeNull();
    const { data: stage } = await admin
      .from("stage")
      .select("id, spec_id")
      .eq("id", attempt.current_stage_id)
      .single();
    expect(stage!.spec_id).toBe("stage-sultan");

    const { data: stageZero } = await admin
      .from("stage")
      .select("id")
      .eq("spec_version_id", specVersionId)
      .eq("spec_id", "stage-landing")
      .single();
    const { data: commitments } = await admin
      .from("stage_commitment")
      .select("id")
      .eq("attempt_id", attemptId)
      .eq("stage_id", stageZero!.id);
    expect(commitments).toHaveLength(4);

    const { data: resolutions, error: resolutionError } = await admin
      .from("resolution")
      .select("rolls, outcome")
      .eq("attempt_id", attemptId)
      .eq("stage_id", stageZero!.id);
    expect(resolutionError).toBeNull();
    expect(resolutions).toHaveLength(1);
    expect(resolutions![0].rolls).toBeTruthy();
    expect(resolutions![0].outcome.rationale).toBeTruthy();
    expect(resolutions![0].outcome.privateNotes).toBeTruthy();
  });

  it("keeps runtime and resolution internals out of student reads and supports resume", async () => {
    const runtime = await student.client
      .from("attempt_runtime")
      .select("snapshot")
      .eq("attempt_id", attemptId);
    expect(runtime.data ?? []).toHaveLength(0);

    const resolution = await student.client
      .from("resolution")
      .select("rolls, outcome")
      .eq("attempt_id", attemptId);
    expect(resolution.data ?? []).toHaveLength(0);

    const resumed = await loadResumeState(student.client, attemptId);
    expect(resumed).not.toBeNull();
    expect(resumed!.journal.map((entry) => entry.id)).toContain("ev-instructions");
    expect(resumed!.transcript.some((message) => message.body === "Show me the instructions.")).toBe(true);
  });
});
