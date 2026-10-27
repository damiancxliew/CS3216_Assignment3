import { beforeAll, describe, expect, it } from "vitest";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail } from "./helpers";
const admin = serviceClient();
const store = new SupabaseV3PlayStore(admin);
let school: string, owner: Awaited<ReturnType<typeof createUserClient>>, publisher: Awaited<ReturnType<typeof createUserClient>>;
beforeAll(async () => {
  school = await createOrganization("Publisher attribution school");
  owner = await createUserClient(uniqueEmail("publisher-owner"));
  publisher = await createUserClient(uniqueEmail("publisher-staff"));
  await addMember(school, owner.userId, "teacher");
  await addMember(school, publisher.userId, "admin");
  expect((await admin.from("profile").update({ display_name: "Ms Publisher" }).eq("id", publisher.userId)).error).toBeNull();
});
async function adventure() {
  const result = await admin.from("adventures_v3").insert({ owner_id: owner.userId, school_id: school, status: "draft", spec: { title: "First draft" } }).select("id").single();
  if (result.error) throw result.error;
  return result.data.id as string;
}
describe("persisted publication attribution", () => {
  it("loads the actual publisher profile, retains historical versions and attributes republishing", async () => {
    const id = await adventure();
    expect(await store.publishVersion(id, 1, null, true, undefined, publisher.userId)).toBe(true);
    const first = (await store.listPublications(id))[0];
    expect(first).toMatchObject({ version: 1, publishedBy: publisher.userId, publisherName: "Ms Publisher" });
    expect(first.firstPublishedAt).not.toBeNull();
    // A no-op and a stale request must not overwrite attribution.
    expect(await store.publishVersion(id, 1, 1, true, undefined, owner.userId)).toBe(true);
    expect(await store.publishVersion(id, 9, 1, true, undefined, owner.userId)).toBe(false);
    expect((await store.listPublications(id))[0]).toEqual(first);
    expect(await store.saveDraft(id, 1, { title: "Second draft" })).toMatchObject({ saved: true, version: 2 });
    expect(await store.publishVersion(id, 2, 1, true, 2, owner.userId)).toBe(true);
    expect(await store.publishVersion(id, 2, 2, true, 1, owner.userId)).toBe(true);
    const rows = await store.listPublications(id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: 2, publishedBy: owner.userId });
    expect(rows[1]).toMatchObject({ version: 1, publishedBy: owner.userId, firstPublishedAt: first.firstPublishedAt, linkKey: first.linkKey });
    expect(rows[1].lastPublishedAt! >= first.lastPublishedAt!).toBe(true);
    expect((await store.loadAdventure(id))?.specVersion).toBe(2);
  });
  it("preserves legacy RPC compatibility and records an unknown actor honestly", async () => {
    const id = await adventure();
    expect(await store.publishVersion(id, 1, null, true)).toBe(true);
    expect((await store.listPublications(id))[0]).toMatchObject({ publishedBy: null, publisherName: null });
    expect(await store.publishVersion(id, 1, 1, false)).toBe(true);
    expect(await store.publishVersion(id, 1, null, true, undefined, publisher.userId)).toBe(true);
    expect((await store.listPublications(id))[0].publishedBy).toBe(publisher.userId);
    await store.publishVersion(id, 1, 1, false);
    await store.publishVersion(id, 1, null, true);
    expect((await store.listPublications(id))[0]).toMatchObject({ publishedBy: null, publisherName: null });
  });
  it("does not let clients forge publication identities through the service-only RPC", async () => {
    const id = await adventure();
    const result = await publisher.client.rpc("publish_attributed_version_v3", {
      p_id: id, p_expected_version: 1, p_expected_published: null, p_publish: true,
      p_publisher_id: owner.userId, p_selected_version: null,
    });
    expect(result.error).not.toBeNull();
    expect(await store.listPublications(id)).toEqual([]);
  });
});
