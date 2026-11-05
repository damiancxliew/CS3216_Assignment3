import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail } from "./helpers";
const admin = serviceClient();
let school: string, owner: string;
beforeAll(async () => {
  school = await createOrganization("ZIP version test school");
  owner = (await createUserClient(uniqueEmail("zip-version"))).userId;
  await addMember(school, owner, "teacher");
});

describe("version imports and selected publication", () => {
  it("atomically replaces source text, preserves old snapshots and keeps the published pointer", async () => {
    const { data: a, error } = await admin.from("adventures_v3").insert({ owner_id: owner, school_id: school, status: "draft", spec: { title: "Original" } }).select().single();
    expect(error).toBeNull();
    expect((await admin.from("sources_v3").insert({ adventure_id: a.id, source_key: "reading", origin: "upload", kind: "text", title: "Old reading", storage_key: "inline:test", content_hash: "old", pages: [{ page: 1, text: "Original text" }] })).error).toBeNull();
    expect((await admin.rpc("publish_adventure_v3", { p_id: a.id, p_expected_version: 1, p_expected_published: null, p_publish: true })).data).toBe(true);
    const sources = [{ id: "reading", title: "Updated reading", kind: "text", pages: [{ page: 1, text: "Updated text" }] }];
    const update = await admin.rpc("import_adventure_version_v3", { p_id: a.id, p_expected_version: 1, p_expected_published: 1, p_spec: { title: "Updated" }, p_sources: sources });
    expect(update.error).toBeNull();
    expect(update.data).toEqual({ saved: true, version: 2 });
    const { data: contexts } = await admin.from("adventure_version_context_v3").select().eq("adventure_id", a.id).order("version");
    expect(contexts?.[0].sources[0].pages[0].text).toBe("Original text");
    expect(contexts?.[1].sources).toEqual(sources);
    expect((await admin.from("sources_v3").select("content_hash").eq("adventure_id", a.id)).data?.[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await admin.from("adventures_v3").select().eq("id", a.id).single()).data).toMatchObject({ status: "published", published_version: 1, spec_version: 2 });
    expect((await admin.from("adventure_versions_v3").select("version,spec").eq("adventure_id", a.id).order("version")).data).toEqual([{ version: 1, spec: { title: "Original" } }, { version: 2, spec: { title: "Updated" } }]);
    const selected = await admin.rpc("publish_selected_version_v3", { p_id: a.id, p_expected_version: 2, p_expected_published: 1, p_selected_version: 2 });
    expect(selected.error).toBeNull(); expect(selected.data).toBe(true);
    expect((await admin.rpc("publish_selected_version_v3", { p_id: a.id, p_expected_version: 2, p_expected_published: 2, p_selected_version: 1 })).data).toBe(true);
    expect((await admin.from("adventures_v3").select().eq("id", a.id).single()).data).toMatchObject({ published_version: 1, spec_version: 2 });
    const stale = await admin.rpc("import_adventure_version_v3", { p_id: a.id, p_expected_version: 1, p_expected_published: 1, p_spec: { title: "Stale" }, p_sources: [] });
    expect(stale.data).toEqual({ saved: false });
    expect((await admin.from("sources_v3").select("pages").eq("adventure_id", a.id)).data?.[0].pages[0].text).toBe("Updated text");
    const invalid = await admin.rpc("import_adventure_version_v3", { p_id: a.id, p_expected_version: 2, p_expected_published: 1, p_spec: { title: "Invalid" }, p_sources: [{ id: "missing-fields" }] });
    expect(invalid.error).not.toBeNull();
    expect((await admin.from("adventures_v3").select("spec_version").eq("id", a.id).single()).data?.spec_version).toBe(2);
    expect((await admin.from("sources_v3").select("pages").eq("adventure_id", a.id)).data?.[0].pages[0].text).toBe("Updated text");
  });
});
