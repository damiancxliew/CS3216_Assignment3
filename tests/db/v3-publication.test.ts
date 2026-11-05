import { beforeAll, describe, expect, it } from "vitest";
import {
  createOrganization,
  createUserClient,
  addMember,
  serviceClient,
  uniqueEmail,
} from "./helpers";
const admin = serviceClient();
let school: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
async function adventure() {
  const { data, error } = await admin
    .from("adventures_v3")
    .insert({
      school_id: school,
      owner_id: owner.userId,
      status: "draft",
      spec: { title: "v1" },
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
beforeAll(async () => {
  school = await createOrganization("Publication test school");
  owner = await createUserClient(uniqueEmail("publication"));
  await addMember(school, owner.userId, "teacher");
});
describe("publication persistence", () => {
  it("atomically saves, snapshots only changes, and rejects stale saves and publications", async () => {
    const a = await adventure();
    const save = (version: number, title: string) =>
      admin.rpc("save_adventure_v3", {
        p_id: a.id,
        p_expected_version: version,
        p_spec: { title },
      });
    const publish = (v: number, p: number | null, enabled = true) =>
      admin.rpc("publish_adventure_v3", {
        p_id: a.id,
        p_expected_version: v,
        p_expected_published: p,
        p_publish: enabled,
      });
    expect((await save(1, "v1")).data).toEqual({ saved: true, version: 1 });
    expect((await publish(1, null)).data).toBe(true);
    const saves = await Promise.all([save(1, "v2"), save(1, "v3")]);
    expect(saves.filter((r) => r.data.saved)).toHaveLength(1);
    const { data: row } = await admin
      .from("adventures_v3")
      .select()
      .eq("id", a.id)
      .single();
    expect(row).toMatchObject({
      status: "published",
      spec_version: 2,
      published_version: 1,
    });
    expect((await publish(1, 1)).data).toBe(false);
    expect((await publish(2, null, false)).data).toBe(false);
    expect((await publish(2, 1)).data).toBe(true);
    const versions = await admin
      .from("adventure_versions_v3")
      .select()
      .eq("adventure_id", a.id);
    expect(versions.data).toHaveLength(2);
    expect(
      (
        await admin
          .from("adventure_versions_v3")
          .update({ spec: {} })
          .eq("adventure_id", a.id)
      ).error?.message,
    ).toContain("immutable");
  });
  it("rejects unavailable and cross-adventure publication pointers", async () => {
    const a = await adventure();
    const b = await adventure();
    await admin.rpc("save_adventure_v3", {
      p_id: b.id,
      p_expected_version: 1,
      p_spec: { title: "b v2" },
    });
    expect(
      (
        await admin
          .from("adventures_v3")
          .update({ published_version: 2 })
          .eq("id", a.id)
      ).error?.code,
    ).toBe("23503");
  });
  it("checks the publication pointer when inserting initialized attempts", async () => {
    const a = await adventure();
    await admin.rpc("publish_adventure_v3", {
      p_id: a.id,
      p_expected_version: 1,
      p_expected_published: null,
      p_publish: true,
    });
    await admin.rpc("save_adventure_v3", {
      p_id: a.id,
      p_expected_version: 1,
      p_spec: { title: "v2" },
    });
    const start = (v: number) =>
      admin.rpc("start_attempt_v3", {
        p_adventure_id: a.id,
        p_spec_version: v,
        p_student_id: owner.userId,
        p_state: {},
      });
    expect((await start(2)).data).toBeNull();
    expect((await start(1)).data?.id).toBeTruthy();
    await admin.rpc("publish_adventure_v3", {
      p_id: a.id,
      p_expected_version: 2,
      p_expected_published: 1,
      p_publish: true,
    });
    expect((await start(1)).data).toBeNull();
    expect((await start(2)).data?.id).toBeTruthy();
  });
  it("denies authenticated direct writes and mutation RPCs", async () => {
    const a = await adventure();
    expect(
      (
        await owner.client
          .from("adventures_v3")
          .update({ spec: {}, status: "published" })
          .eq("id", a.id)
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await owner.client
          .from("adventures_v3")
          .insert({ school_id: school, owner_id: owner.userId })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await owner.client.rpc("save_adventure_v3", {
          p_id: a.id,
          p_expected_version: 1,
          p_spec: {},
        })
      ).error?.code,
    ).toBe("42501");
  });
});

it("records publication history atomically and retains earlier releases after unpublishing", async () => {
  const a = await adventure();
  const publish = (v: number, p: number | null, enabled: boolean) =>
    admin.rpc("publish_adventure_v3", {
      p_id: a.id,
      p_expected_version: v,
      p_expected_published: p,
      p_publish: enabled,
    });
  expect((await publish(1, null, true)).data).toBe(true);
  await admin.rpc("save_adventure_v3", {
    p_id: a.id,
    p_expected_version: 1,
    p_spec: { title: "v2" },
  });
  expect((await publish(1, 1, true)).data).toBe(false);
  expect((await publish(2, 1, true)).data).toBe(true);
  expect((await publish(2, 2, false)).data).toBe(true);
  const history = await owner.client
    .from("adventure_publications_v3")
    .select()
    .eq("adventure_id", a.id)
    .order("version");
  expect(history.error).toBeNull();
  expect(history.data?.map((row) => row.version)).toEqual([1, 2]);
  expect(
    history.data?.every(
      (row) => row.first_published_at && row.last_published_at,
    ),
  ).toBe(true);
  expect(
    (
      await owner.client
        .from("adventure_publications_v3")
        .insert({ adventure_id: a.id, version: 2 })
    ).error?.code,
  ).toBe("42501");
});

it("keeps old release links playable and rejects mismatched or forged release keys", async () => {
  const a = await adventure();
  const publish = (v: number, p: number | null) =>
    admin.rpc("publish_adventure_v3", {
      p_id: a.id,
      p_expected_version: v,
      p_expected_published: p,
      p_publish: true,
    });
  await publish(1, null);
  const { data: first } = await admin
    .from("adventure_publications_v3")
    .select()
    .eq("adventure_id", a.id)
    .single();
  await admin.rpc("save_adventure_v3", {
    p_id: a.id,
    p_expected_version: 1,
    p_spec: { title: "v2" },
  });
  await publish(2, 1);
  const start = (version: number, release: string) =>
    admin.rpc("start_attempt_v3", {
      p_adventure_id: a.id,
      p_spec_version: version,
      p_student_id: owner.userId,
      p_state: {},
      p_release: release,
    });
  expect((await start(1, first.link_key)).data?.id).toBeTruthy();
  expect((await start(2, first.link_key)).data).toBeNull();
  expect((await start(1, crypto.randomUUID())).data).toBeNull();
  await publish(2, 2);
  const history = await admin
    .from("adventure_publications_v3")
    .select()
    .eq("adventure_id", a.id)
    .order("version");
  expect(history.data).toHaveLength(2);
  expect(history.data?.[0].link_key).toBe(first.link_key);
});
