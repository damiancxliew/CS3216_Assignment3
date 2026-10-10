import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { loadReflectionSummary } from "@/lib/attempts/reflection";
import { createUserClient, prepareVersionMaps, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };
let otherStudent: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("reflection-teacher"), "password123!", "teacher");
  student = await createUserClient(uniqueEmail("reflection-student"), "password123!", "student");
  otherStudent = await createUserClient(uniqueEmail("reflection-other-student"), "password123!", "student");
});

async function seedAttempt(completed = true) {
  const { data: adventure, error: adventureError } = await admin
    .from("adventure")
    .insert({ owner_id: teacher.userId, title: "A Treaty at the River" })
    .select("id, share_token")
    .single();
  if (adventureError) throw adventureError;

  const { data: version, error: versionError } = await admin
    .from("spec_version")
    .insert({
      adventure_id: adventure.id,
      version: 1,
      json: {
        title: "A Treaty at the River",
        stages: [{ index: 0, title: "The Landing", evidence: [] }],
        sources: [],
        assumptions: [],
        endings: [{
          id: "agreement",
          title: "An agreement",
          summary: "The agreement was signed.",
          historicalOutcome: { text: "The historical record.", spans: [], assumptionIds: [] },
          divergence: "The simulated path differed.",
          reflectionQuestions: [],
        }],
      },
      generator_version: "test",
    })
    .select("id")
    .single();
  if (versionError) throw versionError;

  const { error: stageError } = await admin.from("stage").insert({
    spec_version_id: version.id,
    index: 0,
    title: "The Landing",
  });
  if (stageError) throw stageError;
  await prepareVersionMaps(admin, version.id);
  const { error: publishError } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure.id });
  if (publishError) throw publishError;

  const { data: attemptId, error: joinError } = await student.client.rpc("join_adventure", { p_token: adventure.share_token });
  if (joinError) throw joinError;
  if (completed) {
    const { error: completeError } = await admin.rpc("complete_attempt", { p_attempt_id: attemptId, p_ending_id: "agreement" });
    if (completeError) throw completeError;
  }
  return { adventureId: adventure.id as string, attemptId: attemptId as string };
}

function reflection(attemptId: string, choice = "Trade") {
  return {
    attempt_id: attemptId,
    prompt_key: "factor" as const,
    choice,
    choice_label: choice,
    stance: null,
    response: "Trade mattered because the agreement changed the balance of power.",
    counter: null,
  };
}

describe("attempt reflections", () => {
  it("allows the owner to upsert, update, and read a reflection", async () => {
    const { attemptId } = await seedAttempt();
    const first = reflection(attemptId);
    const { error: insertError } = await student.client.from("attempt_reflection").upsert(first, {
      onConflict: "attempt_id,prompt_key",
    });
    expect(insertError).toBeNull();

    const updated = { ...first, choice: "Diplomacy", choice_label: "Diplomacy" };
    const { error: updateError } = await student.client.from("attempt_reflection").upsert(updated, {
      onConflict: "attempt_id,prompt_key",
    });
    expect(updateError).toBeNull();

    const { data, error } = await student.client
      .from("attempt_reflection")
      .select("attempt_id, prompt_key, choice, choice_label, response")
      .eq("attempt_id", attemptId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ attempt_id: attemptId, prompt_key: "factor", choice: "Diplomacy", choice_label: "Diplomacy" });
  });

  it("hides another student's reflection and refuses their insert", async () => {
    const { attemptId } = await seedAttempt();
    const { error: ownerInsertError } = await student.client.from("attempt_reflection").insert(reflection(attemptId));
    expect(ownerInsertError).toBeNull();

    const { data, error: selectError } = await otherStudent.client
      .from("attempt_reflection")
      .select("attempt_id")
      .eq("attempt_id", attemptId);
    expect(selectError).toBeNull();
    expect(data).toEqual([]);

    const { error: insertError } = await otherStudent.client.from("attempt_reflection").insert(reflection(attemptId));
    expect(insertError).not.toBeNull();
  });

  it("allows the adventure teacher to read reflections but not insert them", async () => {
    const { attemptId } = await seedAttempt();
    const { error: ownerInsertError } = await student.client.from("attempt_reflection").insert(reflection(attemptId));
    expect(ownerInsertError).toBeNull();

    const { data, error: selectError } = await teacher.client
      .from("attempt_reflection")
      .select("attempt_id, prompt_key")
      .eq("attempt_id", attemptId);
    expect(selectError).toBeNull();
    expect(data).toHaveLength(1);

    const { error: insertError } = await teacher.client.from("attempt_reflection").insert({
      ...reflection(attemptId, "A different factor"),
      prompt_key: "evidence",
    });
    expect(insertError).not.toBeNull();
  });

  it("rejects inserts for attempts that are not completed", async () => {
    const { attemptId } = await seedAttempt(false);
    const { error } = await student.client.from("attempt_reflection").insert(reflection(attemptId));
    expect(error).not.toBeNull();
  });

  it("loads the adventure's aggregated reflections through a teacher client", async () => {
    const { adventureId, attemptId } = await seedAttempt();
    const { error } = await student.client.from("attempt_reflection").insert(reflection(attemptId));
    expect(error).toBeNull();

    const summary = await loadReflectionSummary(teacher.client, adventureId);
    expect(summary.respondents).toBe(1);
    expect(summary.factors).toEqual([{ phrase: "Trade", count: 1, attemptIds: [attemptId] }]);
  });
});
