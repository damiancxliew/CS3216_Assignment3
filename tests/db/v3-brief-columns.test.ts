import { beforeAll, describe, expect, it } from "vitest";
import {
  serviceClient,
  addMember,
  createOrganization,
  createUserClient,
  uniqueEmail,
} from "./helpers";

const password = "password123!";

async function createMember(schoolId: string, role: "admin" | "teacher") {
  const user = await createUserClient(uniqueEmail(`v3-brief-${role}`), password);
  await addMember(schoolId, user.userId, role);
  return user;
}

let schoolId: string;
let otherSchoolId: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
let otherTeacher: Awaited<ReturnType<typeof createUserClient>>;

async function insertAdventure(over: Record<string, unknown> = {}) {
  return serviceClient()
    .from("adventures_v3")
    .insert({ school_id: schoolId, owner_id: owner.userId, ...over })
    .select("id")
    .single();
}

beforeAll(async () => {
  schoolId = await createOrganization("V3 Brief School");
  otherSchoolId = await createOrganization("V3 Brief Other School");
  owner = await createMember(schoolId, "teacher");
  otherTeacher = await createMember(otherSchoolId, "teacher");
});

describe("adventures_v3 brief columns (#223)", () => {
  it("accepts status 'briefing'", async () => {
    const { data, error } = await insertAdventure({ status: "briefing" });
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("rejects an unknown status", async () => {
    const { error } = await insertAdventure({ status: "bogus" });
    expect(error).not.toBeNull();
  });

  it("brief_state, skeleton_draft and title exist and default to null", async () => {
    const { data, error } = await insertAdventure({ status: "briefing" });
    expect(error).toBeNull();
    const { data: row, error: readError } = await owner.client
      .from("adventures_v3")
      .select("brief_state, skeleton_draft, title")
      .eq("id", data!.id)
      .single();
    expect(readError).toBeNull();
    expect(row).toEqual({ brief_state: null, skeleton_draft: null, title: null });
  });

  it("rejects a title longer than 200 characters", async () => {
    const { error } = await insertAdventure({ title: "x".repeat(201) });
    expect(error).not.toBeNull();
    const { error: okError } = await insertAdventure({ title: "x".repeat(200) });
    expect(okError).toBeNull();
  });

  it("keeps the row — brief_state included — invisible to another school's teacher", async () => {
    const { data, error } = await insertAdventure({
      status: "briefing",
      brief_state: { slot: "episode", draft: { episode: "Secret episode" } },
      title: "Secret episode",
    });
    expect(error).toBeNull();

    const { data: ownerRows } = await owner.client
      .from("adventures_v3")
      .select("id, brief_state, skeleton_draft, title")
      .eq("id", data!.id);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows![0].brief_state).toMatchObject({ slot: "episode" });

    const { data: otherRows, error: otherError } = await otherTeacher.client
      .from("adventures_v3")
      .select("id, brief_state, skeleton_draft, title")
      .eq("id", data!.id);
    expect(otherError).toBeNull();
    expect(otherRows).toEqual([]);
  });
});
