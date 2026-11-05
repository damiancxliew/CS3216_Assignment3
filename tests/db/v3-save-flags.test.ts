import { beforeAll, describe, expect, it } from "vitest";

import {
  addMember,
  createOrganization,
  createUserClient,
  serviceClient,
  uniqueEmail,
} from "./helpers";

const admin = serviceClient();
const password = "password123!";

let schoolId: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
let student: Awaited<ReturnType<typeof createUserClient>>;

beforeAll(async () => {
  schoolId = await createOrganization("V3 Save Flags Test School");
  owner = await createUserClient(uniqueEmail("v3-flags-owner"), password);
  await addMember(schoolId, owner.userId, "teacher");
  student = await createUserClient(uniqueEmail("v3-flags-student"), password);
  await addMember(schoolId, student.userId, "student");
});

describe("v3 moderation flag persistence", () => {
  it("saves flags atomically, deduplicates them, and preserves four-argument saves", async () => {
    const { data: adventure, error: adventureError } = await admin
      .from("adventures_v3")
      .insert({ school_id: schoolId, owner_id: owner.userId, spec: { title: "Flags" } })
      .select("id, spec_version")
      .single();
    expect(adventureError).toBeNull();

    const { data: attempt, error: attemptError } = await admin
      .from("attempts_v3")
      .insert({
        adventure_id: adventure.id,
        spec_version: adventure.spec_version,
        student_id: student.userId,
        state: { step: 0 },
      })
      .select("id")
      .single();
    expect(attemptError).toBeNull();

    const flag = {
      messageId: "message-1",
      category: "abusive",
      excerpt: "A private excerpt",
      result: { reason: "insult", characterId: "temenggong", stageIndex: 0 },
    };
    const firstSave = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 0,
      p_state: { step: 1 },
      p_events: [],
      p_flags: [flag],
    });
    expect(firstSave.error).toBeNull();
    expect(firstSave.data).toMatchObject({ saved: true, revision: 1 });

    const secondSave = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 1,
      p_state: { step: 2 },
      p_events: [],
      p_flags: [flag],
    });
    expect(secondSave.error).toBeNull();
    expect(secondSave.data).toMatchObject({ saved: true, revision: 2 });

    const staleSave = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 1,
      p_state: { step: "stale" },
      p_events: [],
      p_flags: [{ ...flag, messageId: "message-stale" }],
    });
    expect(staleSave.error).toBeNull();
    expect(staleSave.data).toEqual({ saved: false, revision: 2 });

    const legacySave = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 2,
      p_state: { step: 3 },
      p_events: [],
    });
    expect(legacySave.error).toBeNull();
    expect(legacySave.data).toMatchObject({ saved: true, revision: 3 });

    const { data: flags, error: flagsError } = await admin
      .from("flags_v3")
      .select("message_id, category, excerpt, result")
      .eq("attempt_id", attempt.id);
    expect(flagsError).toBeNull();
    expect(flags).toEqual([{
      message_id: "message-1",
      category: "abusive",
      excerpt: "A private excerpt",
      result: { reason: "insult", characterId: "temenggong", stageIndex: 0 },
    }]);

    const { data: ownerFlags, error: ownerFlagsError } = await owner.client
      .from("flags_v3").select("message_id").eq("attempt_id", attempt.id);
    expect(ownerFlagsError).toBeNull();
    expect(ownerFlags).toEqual([{ message_id: "message-1" }]);

    const { data: studentFlags, error: studentFlagsError } = await student.client
      .from("flags_v3").select("message_id").eq("attempt_id", attempt.id);
    expect(studentFlagsError).toBeNull();
    expect(studentFlags).toEqual([]);
  });
});
