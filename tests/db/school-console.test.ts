import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();
const PASSWORD = "password123!";

type User = { client: SupabaseClient; userId: string };
type Adventure = { id: string; shareToken: string; versionId: string };
type RosterRow = { user_id: string; role: string; status: string; email: string; joined_at: string; removed_at: string | null };
type UsageRow = {
  adventure_id: string;
  attempts: number;
  students: number;
  completed: number;
  play_seconds: number;
  play_tokens: number;
  image_cost_usd: number | string;
};

let schoolId: string;
let otherSchoolId: string;
let schoolAdmin: User;
let teacher: User;
let otherTeacher: User;
let studentOne: User;
let studentTwo: User;
let otherAdmin: User;

async function member(organizationId: string, role: "admin" | "teacher" | "student"): Promise<User> {
  const user = await createUserClient(uniqueEmail(`school-console-${role}`), PASSWORD);
  await addMember(organizationId, user.userId, role);
  return user;
}

async function createPublishedAdventure(owner: string, organizationId: string, title: string): Promise<Adventure> {
  const { data: adventure, error } = await admin.from("adventure")
    .insert({ owner_id: owner, organization_id: organizationId, title, allow_retries: true })
    .select("id, share_token")
    .single();
  if (error) throw error;
  const { data: version, error: versionError } = await admin.from("spec_version")
    .insert({ adventure_id: adventure.id, version: 1, json: {}, generator_version: "school-console-test" })
    .select("id")
    .single();
  if (versionError) throw versionError;
  const { error: publishError } = await admin.from("adventure")
    .update({ status: "published", published_version: 1 })
    .eq("id", adventure.id);
  if (publishError) throw publishError;
  return { id: adventure.id, shareToken: adventure.share_token, versionId: version.id };
}

beforeAll(async () => {
  schoolId = await createOrganization("School Console Test");
  otherSchoolId = await createOrganization("Other Console Test");
  schoolAdmin = await member(schoolId, "admin");
  teacher = await member(schoolId, "teacher");
  otherTeacher = await member(schoolId, "teacher");
  studentOne = await member(schoolId, "student");
  studentTwo = await member(schoolId, "student");
  otherAdmin = await member(otherSchoolId, "admin");
});

describe("school_roster", () => {
  it("returns all school members and their emails to staff, and denies students and other schools", async () => {
    for (const caller of [teacher, schoolAdmin]) {
      const { data, error } = await caller.client.rpc("school_roster", { p_org: schoolId });
      expect(error).toBeNull();
      const rows = data as RosterRow[];
      expect(rows.map((row) => row.user_id)).toEqual(expect.arrayContaining([
        schoolAdmin.userId, teacher.userId, otherTeacher.userId, studentOne.userId, studentTwo.userId,
      ]));
      expect(rows.every((row) => Boolean(row.email))).toBe(true);
    }

    expect((await studentOne.client.rpc("school_roster", { p_org: schoolId })).error?.code).toBe("42501");
    expect((await otherAdmin.client.rpc("school_roster", { p_org: schoolId })).error?.code).toBe("42501");
  });

  it("reports removed students and their removal time", async () => {
    expect((await teacher.client.rpc("remove_student", {
      p_org: schoolId,
      p_user: studentOne.userId,
    })).error).toBeNull();
    const { data, error } = await teacher.client.rpc("school_roster", { p_org: schoolId });
    expect(error).toBeNull();
    const row = (data as RosterRow[]).find((memberRow) => memberRow.user_id === studentOne.userId);
    expect(row).toMatchObject({ status: "removed" });
    expect(row?.removed_at).toBeTruthy();
    expect((await teacher.client.rpc("restore_student", {
      p_org: schoolId,
      p_user: studentOne.userId,
    })).error).toBeNull();
  });
});

describe("school_usage", () => {
  it("returns exact activity totals, zeroes for idle adventures, and denies teachers", async () => {
    const adventure = await createPublishedAdventure(teacher.userId, schoolId, "Usage adventure");
    const idle = await createPublishedAdventure(teacher.userId, schoolId, "Idle adventure");
    const { data: attemptOne, error: joinOneError } = await studentOne.client.rpc("join_adventure", { p_token: adventure.shareToken });
    const { data: attemptTwo, error: joinTwoError } = await studentTwo.client.rpc("join_adventure", { p_token: adventure.shareToken });
    expect(joinOneError).toBeNull();
    expect(joinTwoError).toBeNull();
    const { error: completedError } = await admin.from("attempt").update({ status: "completed" }).eq("id", attemptOne);
    expect(completedError).toBeNull();
    const { error: telemetryError } = await admin.from("attempt_telemetry").insert([
      { attempt_id: attemptOne, stage_index: 0, ended_by: "decision", duration_seconds: 30, tokens: 100 },
      { attempt_id: attemptTwo, stage_index: 0, ended_by: "decision", duration_seconds: 45, tokens: 250 },
    ]);
    expect(telemetryError).toBeNull();
    const { error: assetError } = await admin.from("asset").insert([
      { spec_version_id: adventure.versionId, asset_id: "cost-one", entity_id: "one", kind: "portrait", status: "ready", url: "https://assets.test/one.png", placeholder_url: "https://assets.test/placeholder.png", prompt_hash: "school-console-cost-one", cost_usd: 0.01 },
      { spec_version_id: adventure.versionId, asset_id: "cost-two", entity_id: "two", kind: "portrait", status: "ready", url: "https://assets.test/two.png", placeholder_url: "https://assets.test/placeholder.png", prompt_hash: "school-console-cost-two", cost_usd: 0.02 },
    ]);
    expect(assetError).toBeNull();

    const { data, error } = await schoolAdmin.client.rpc("school_usage", { p_org: schoolId });
    expect(error).toBeNull();
    const rows = data as UsageRow[];
    expect(rows.find((row) => row.adventure_id === adventure.id)).toMatchObject({
      attempts: 2, students: 2, completed: 1, play_seconds: 75, play_tokens: 350,
    });
    expect(Number(rows.find((row) => row.adventure_id === adventure.id)?.image_cost_usd)).toBeCloseTo(0.03, 5);
    expect(rows.find((row) => row.adventure_id === idle.id)).toMatchObject({
      attempts: 0, students: 0, completed: 0, play_seconds: 0, play_tokens: 0, image_cost_usd: 0,
    });
    expect((await teacher.client.rpc("school_usage", { p_org: schoolId })).error?.code).toBe("42501");
    expect((await otherAdmin.client.rpc("school_usage", { p_org: schoolId })).error?.code).toBe("42501");
  });
});

describe("set_adventure_archived", () => {
  it("archives published adventures for admins, removes them from student play, and restores their status", async () => {
    const adventure = await createPublishedAdventure(teacher.userId, schoolId, "Archive target");
    expect((await schoolAdmin.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure.id,
      p_archived: true,
    })).data).toBe("archived");
    expect((await studentOne.client.rpc("start_adventure", { p_adventure_id: adventure.id })).error?.code).toBe("P0002");
    const { data: library } = await studentOne.client.rpc("list_library");
    expect(library).not.toContainEqual(expect.objectContaining({ adventure_id: adventure.id }));

    expect((await schoolAdmin.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure.id,
      p_archived: false,
    })).data).toBe("published");
    expect((await otherTeacher.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure.id,
      p_archived: true,
    })).error?.code).toBe("42501");
    expect((await otherAdmin.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure.id,
      p_archived: true,
    })).error?.code).toBe("42501");
    expect((await teacher.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure.id,
      p_archived: true,
    })).data).toBe("archived");
  });

  it("unarchives a draft as draft", async () => {
    const { data: adventure, error } = await admin.from("adventure")
      .insert({ owner_id: teacher.userId, organization_id: schoolId, title: "Draft to unarchive", status: "draft" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect((await teacher.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure!.id,
      p_archived: true,
    })).data).toBe("archived");
    expect((await schoolAdmin.client.rpc("set_adventure_archived", {
      p_adventure_id: adventure!.id,
      p_archived: false,
    })).data).toBe("draft");
  });
});
