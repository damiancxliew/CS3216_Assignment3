import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  addMember,
  createOrganization,
  createUserClient,
  serviceClient,
  uniqueEmail,
} from "./helpers";

const password = "password123!";
const admin = serviceClient();

async function createMember(schoolId: string, role: "admin" | "teacher" | "student") {
  const user = await createUserClient(uniqueEmail(`v3-${role}`), password);
  await addMember(schoolId, user.userId, role);
  return user;
}

async function createAdventure(spec: unknown = { title: "Initial" }) {
  const { data, error } = await owner.client
    .from("adventures_v3")
    .insert({ school_id: schoolId, owner_id: owner.userId, spec })
    .select("id, spec_version")
    .single();
  if (error) throw error;
  return data as { id: string; spec_version: number };
}

const anon = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

let schoolId: string;
let otherSchoolId: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
let peerTeacher: Awaited<ReturnType<typeof createUserClient>>;
let schoolAdmin: Awaited<ReturnType<typeof createUserClient>>;
let student: Awaited<ReturnType<typeof createUserClient>>;
let otherTeacher: Awaited<ReturnType<typeof createUserClient>>;

beforeAll(async () => {
  schoolId = await createOrganization("V3 Test School");
  otherSchoolId = await createOrganization("V3 Other School");
  owner = await createMember(schoolId, "teacher");
  peerTeacher = await createMember(schoolId, "teacher");
  schoolAdmin = await createMember(schoolId, "admin");
  student = await createMember(schoolId, "student");
  otherTeacher = await createMember(otherSchoolId, "teacher");
});

describe("adventures_v3 and pinned versions", () => {
  it("limits adventures to owners, school admins, and sysadmins", async () => {
    const adventure = await createAdventure();
    expect(adventure.spec_version).toBe(1);

    const { data: ownerRows, error: ownerError } = await owner.client
      .from("adventures_v3").select("id").eq("id", adventure.id);
    expect(ownerError).toBeNull();
    expect(ownerRows).toHaveLength(1);

    const { data: peerRows, error: peerError } = await peerTeacher.client
      .from("adventures_v3").select("id").eq("id", adventure.id);
    expect(peerError).toBeNull();
    expect(peerRows).toEqual([]);

    const { data: adminRows, error: adminError } = await schoolAdmin.client
      .from("adventures_v3").select("id").eq("id", adventure.id);
    expect(adminError).toBeNull();
    expect(adminRows).toHaveLength(1);

    const { data: studentRows, error: studentError } = await student.client
      .from("adventures_v3").select("id").eq("id", adventure.id);
    expect(studentError).toBeNull();
    expect(studentRows).toEqual([]);

    const { data: anonRows, error: anonError } = await anon()
      .from("adventures_v3").select("id").eq("id", adventure.id);
    expect(anonError?.code).toBe("42501");
    expect(anonRows).toBeNull();

    const denied = await otherTeacher.client
      .from("adventures_v3")
      .insert({ school_id: schoolId, owner_id: otherTeacher.userId, spec: {} });
    expect(denied.error?.code).toBe("42501");
  });

  it("increments only on spec changes, ignores client version edits, and snapshots specs", async () => {
    const adventure = await createAdventure(null);
    expect(adventure.spec_version).toBe(0);

    const { data: firstUpdate, error: firstError } = await owner.client
      .from("adventures_v3")
      .update({ spec: { title: "First" }, spec_version: 400 })
      .eq("id", adventure.id)
      .select("spec_version")
      .single();
    expect(firstError).toBeNull();
    expect(firstUpdate?.spec_version).toBe(1);

    const { data: unchanged, error: unchangedError } = await owner.client
      .from("adventures_v3")
      .update({ status: "draft", spec_version: 999 })
      .eq("id", adventure.id)
      .select("spec_version")
      .single();
    expect(unchangedError).toBeNull();
    expect(unchanged?.spec_version).toBe(1);

    const { data: secondUpdate, error: secondError } = await owner.client
      .from("adventures_v3")
      .update({ spec: { title: "Second" } })
      .eq("id", adventure.id)
      .select("spec_version")
      .single();
    expect(secondError).toBeNull();
    expect(secondUpdate?.spec_version).toBe(2);

    const { data: versions, error: versionsError } = await owner.client
      .from("adventure_versions_v3")
      .select("version, spec")
      .eq("adventure_id", adventure.id)
      .order("version");
    expect(versionsError).toBeNull();
    expect(versions).toEqual([
      { version: 1, spec: { title: "First" } },
      { version: 2, spec: { title: "Second" } },
    ]);

    const { data: staleRows, error: staleError } = await owner.client
      .from("adventures_v3")
      .update({ spec: { title: "Stale edit" } })
      .eq("id", adventure.id)
      .eq("spec_version", 1)
      .select("id");
    expect(staleError).toBeNull();
    expect(staleRows).toEqual([]);
  });
});

describe("v3 attempts, events, and moderation flags", () => {
  it("keeps raw state, events, and flags server-only while allowing staff reads", async () => {
    const adventure = await createAdventure();
    const { data: attempt, error: attemptError } = await admin
      .from("attempts_v3")
      .insert({
        adventure_id: adventure.id,
        spec_version: adventure.spec_version,
        student_id: student.userId,
        state: { hidden: "state" },
      })
      .select("id")
      .single();
    expect(attemptError).toBeNull();

    const { data: saveResult, error: saveError } = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 0,
      p_state: { hidden: "next" },
      p_events: [{ type: "discovery", payload: { detail: "private" } }],
    });
    expect(saveError).toBeNull();
    expect(saveResult).toMatchObject({ saved: true, revision: 1 });

    const { data: flag, error: flagError } = await admin
      .from("flags_v3")
      .insert({
        attempt_id: attempt.id,
        message_id: "message-1",
        category: "safety",
        excerpt: "private excerpt",
        result: { raw: true },
      })
      .select("id")
      .single();
    expect(flagError).toBeNull();

    for (const [client, table] of [
      [student.client, "attempts_v3"],
      [student.client, "attempt_events_v3"],
      [student.client, "flags_v3"],
      [peerTeacher.client, "attempts_v3"],
      [peerTeacher.client, "attempt_events_v3"],
      [peerTeacher.client, "flags_v3"],
    ] as const) {
      const { data, error } = await client.from(table).select("*");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }

    const { data: staffAttempt, error: staffAttemptError } = await owner.client
      .from("attempts_v3").select("id").eq("id", attempt.id);
    expect(staffAttemptError).toBeNull();
    expect(staffAttempt).toHaveLength(1);
    const { data: adminAttempt, error: adminAttemptError } = await schoolAdmin.client
      .from("attempts_v3").select("id").eq("id", attempt.id);
    expect(adminAttemptError).toBeNull();
    expect(adminAttempt).toHaveLength(1);

    const { data: events, error: eventsError } = await schoolAdmin.client
      .from("attempt_events_v3").select("type").eq("attempt_id", attempt.id);
    expect(eventsError).toBeNull();
    expect(events).toEqual([{ type: "discovery" }]);
    const { data: flags, error: flagsError } = await schoolAdmin.client
      .from("flags_v3").select("id").eq("id", flag.id);
    expect(flagsError).toBeNull();
    expect(flags).toHaveLength(1);

    const noAttemptInsert = await owner.client.from("attempts_v3").insert({
      adventure_id: adventure.id,
      spec_version: adventure.spec_version,
      student_id: student.userId,
      state: {},
    });
    expect(noAttemptInsert.error?.code).toBe("42501");
    const noEventInsert = await owner.client.from("attempt_events_v3").insert({
      attempt_id: attempt.id,
      seq: 99,
      type: "manual",
    });
    expect(noEventInsert.error?.code).toBe("42501");
    const noFlagInsert = await owner.client.from("flags_v3").insert({
      attempt_id: attempt.id,
      message_id: "message-2",
      category: "safety",
      excerpt: "client data",
    });
    expect(noFlagInsert.error?.code).toBe("42501");

    const reviewedAt = new Date().toISOString();
    const { error: reviewError } = await schoolAdmin.client
      .from("flags_v3")
      .update({ reviewed_at: reviewedAt, reviewed_by: schoolAdmin.userId })
      .eq("id", flag.id);
    expect(reviewError).toBeNull();
    const { error: excerptError } = await schoolAdmin.client
      .from("flags_v3")
      .update({ excerpt: "tampered" })
      .eq("id", flag.id);
    expect(excerptError?.code).toBe("42501");
  });

  it("saves optimistically, serializes concurrent revisions, and appends event sequences", async () => {
    const adventure = await createAdventure();
    const { data: attempt, error: attemptError } = await admin
      .from("attempts_v3")
      .insert({
        adventure_id: adventure.id,
        spec_version: adventure.spec_version,
        student_id: student.userId,
        state: { count: 0 },
      })
      .select("id")
      .single();
    expect(attemptError).toBeNull();

    const args = (state: number, eventType: string) => ({
      p_attempt_id: attempt.id,
      p_expected_revision: 0,
      p_state: { count: state },
      p_events: [{ type: eventType, payload: { state } }],
    });
    const [first, second] = await Promise.all([
      admin.rpc("save_attempt_v3", args(1, "first")),
      admin.rpc("save_attempt_v3", args(2, "second")),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const results = [first.data, second.data] as { saved: boolean; revision: number }[];
    expect(results.filter((result) => result.saved)).toHaveLength(1);
    expect(results.filter((result) => !result.saved)).toEqual([{ saved: false, revision: 1 }]);

    const stale = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 0,
      p_state: {},
      p_events: [],
    });
    expect(stale.data).toEqual({ saved: false, revision: 1 });

    const continued = await admin.rpc("save_attempt_v3", {
      p_attempt_id: attempt.id,
      p_expected_revision: 1,
      p_state: { count: 3 },
      p_events: [
        { type: "third", payload: {} },
        { type: "fourth", payload: {} },
      ],
    });
    expect(continued.error).toBeNull();
    expect(continued.data).toEqual({ saved: true, revision: 2, first_seq: 2 });
    const { data: events, error: eventsError } = await admin
      .from("attempt_events_v3").select("seq").eq("attempt_id", attempt.id).order("seq");
    expect(eventsError).toBeNull();
    expect(events?.map((event) => event.seq)).toEqual([1, 2, 3]);
  });
});
