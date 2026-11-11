import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();
let schoolId: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
let adventureId: string;

beforeAll(async () => {
  schoolId = await createOrganization("Brief removal regression");
  owner = await createUserClient(uniqueEmail("brief-removal"));
  await addMember(schoolId, owner.userId, "teacher");
});
beforeEach(async () => {
  if (adventureId) await admin.from("adventures_v3").delete().eq("id", adventureId);
  adventureId = crypto.randomUUID();
  const state = { ...initialBriefStateV3(adventureId), sources: [
    { id: "upload-one", title: "Account", kind: "text" },
    { id: "upload-two", title: "Second account", kind: "text" },
  ] };
  const { error } = await admin.from("adventures_v3").insert({
    id: adventureId, school_id: schoolId, owner_id: owner.userId, status: "briefing", brief_state: state,
  });
  if (error) throw error;
  const { error: sourceError } = await admin.from("sources_v3").insert(state.sources.map(source => ({
    adventure_id: adventureId, source_key: source.id, origin: "upload", kind: source.kind,
    title: source.title, storage_key: "", content_hash: "fixture", pages: [{ page: 1, text: "Stored source text" }],
  })));
  if (sourceError) throw sourceError;
});
afterAll(async () => {
  if (adventureId) await admin.from("adventures_v3").delete().eq("id", adventureId);
  if (schoolId) {
    await admin.from("organization_member").delete().eq("organization_id", schoolId);
    await admin.from("organization").delete().eq("id", schoolId);
  }
  if (owner) await admin.auth.admin.deleteUser(owner.userId);
});
const remove = (ownerId = owner.userId) => admin.rpc("remove_brief_source_v3", {
  p_adventure_id: adventureId, p_owner_id: ownerId, p_source_key: "upload-one",
});
const sourceRows = () => admin.from("sources_v3").select("source_key,pages").eq("adventure_id", adventureId).order("source_key");

it("atomically removes one source and its metadata, preserving the other source and conversation", async () => {
  const before = await admin.from("adventures_v3").select("brief_state").eq("id", adventureId).single();
  const result = await remove();
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ ...before.data!.brief_state, sources: [before.data!.brief_state.sources[1]] });
  expect((await sourceRows()).data?.map(row => row.source_key)).toEqual(["upload-two"]);
  expect((await remove()).data).toEqual(result.data);
});
it("rolls back source deletion when the brief operation fails", async () => {
  // Deliberately malformed stored data causes an error after DELETE inside the function.
  const { error } = await admin.from("adventures_v3").update({ brief_state: { draft: {}, sources: {} } }).eq("id", adventureId);
  expect(error).toBeNull();
  expect((await remove()).error).not.toBeNull();
  expect((await sourceRows()).data).toHaveLength(2);
  const row = await admin.from("adventures_v3").select("brief_state").eq("id", adventureId).single();
  expect(row.data?.brief_state).toEqual({ draft: {}, sources: {} });
});
it("rejects the wrong owner and authenticated direct calls before deleting anything", async () => {
  expect((await remove(crypto.randomUUID())).error).not.toBeNull();
  const result = await owner.client.rpc("remove_brief_source_v3", {
    p_adventure_id: adventureId, p_owner_id: owner.userId, p_source_key: "upload-one",
  });
  expect(result.error).not.toBeNull();
  expect((await sourceRows()).data).toHaveLength(2);
});
it("rejects a stale removal after source collection finishes", async () => {
  const state = { ...initialBriefStateV3(adventureId), draft: { sources: { summary: "Read", episodeProposal: "Singapore" } } };
  const { error } = await admin.from("adventures_v3").update({ brief_state: state }).eq("id", adventureId);
  expect(error).toBeNull();
  expect((await remove()).error).not.toBeNull();
  expect((await sourceRows()).data).toHaveLength(2);
});
