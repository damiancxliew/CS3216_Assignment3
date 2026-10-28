import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeLlmClient } from "@adventure/orchestration";
import { EngineSpec } from "@adventure/engine";
import { createAttempt, getAttempt, postAction } from "@/lib/play/v3/service";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail, SUPABASE_URL, SUPABASE_ANON_KEY } from "./helpers";

const admin = serviceClient();
let school: string;
let owner: Awaited<ReturnType<typeof createUserClient>>;
let outsider: Awaited<ReturnType<typeof createUserClient>>;

beforeAll(async () => {
  school = await createOrganization("Public play tests");
  owner = await createUserClient(uniqueEmail("public-owner"));
  outsider = await createUserClient(uniqueEmail("public-outsider"));
  await addMember(school, owner.userId, "teacher");
});

async function fixture(kind: "v2" | "v3", spec: unknown = { title: "Public history" }) {
  const table = kind === "v2" ? "adventure" : "adventures_v3";
  const { data, error } = await admin.from(table).insert({ owner_id: owner.userId,
    ...(kind === "v2" ? { organization_id: school, title: "Public history" } : { school_id: school, spec }),
  }).select().single();
  if (error) throw error;
  if (kind === "v2") {
    const version = await admin.from("spec_version").insert({ adventure_id: data.id, version: 1, json: {}, generator_version: "public-test" });
    if (version.error) throw version.error;
  }
  const publication = await admin.from(table).update({ status: "published", published_version: 1 }).eq("id", data.id);
  if (publication.error) throw publication.error;
  return { ...data, table };
}

describe("public adventure authorization", () => {
  for (const kind of ["v2", "v3"] as const) {
    it(`${kind}: defaults to private and lets only authorized staff change access`, async () => {
      const a = await fixture(kind);
      expect(a.is_public).toBe(false);
      const args = { p_id: a.id, p_kind: kind, p_public: true };
      expect((await outsider.client.rpc("set_adventure_public", args)).error?.code).toBe("42501");
      expect((await owner.client.rpc("set_adventure_public", args)).error).toBeNull();
      expect((await admin.from(a.table).select("is_public").eq("id", a.id).single()).data?.is_public).toBe(true);
      expect((await owner.client.rpc("set_adventure_public", { ...args, p_public: false })).error).toBeNull();
    });
  }

  it("plays and resumes v3 anonymously through the real store without granting school access", async () => {
    const spec = EngineSpec.parse(JSON.parse(readFileSync(resolve("fixtures/golden-1819.json"), "utf8")));
    const a = await fixture("v3", spec);
    const guest = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await guest.auth.signInAnonymously();
    expect(login.error).toBeNull();
    const guestId = login.data.user!.id;
    const llm = new FakeLlmClient({ replies: [() => { throw new Error("No model calls expected"); }] });
    const deps = { store: new SupabaseV3PlayStore(admin), now: () => 1000,
      env: {}, llm: () => llm };
    // v3 attempts start from a published version's link ID (#360), not the adventure ID.
    const versionId = (await deps.store.listPublications(a.id)).find((row) => row.version === 1)!.id;
    expect((await createAttempt(deps, guestId, versionId)).status).toBe(404);
    expect((await owner.client.rpc("set_adventure_public", { p_id: a.id, p_kind: "v3", p_public: true })).error).toBeNull();
    expect((await createAttempt(deps, guestId, a.id)).status).toBe(404);
    const first = await createAttempt(deps, guestId, versionId);
    expect(first.status).toBe(201);
    const attemptId = first.body.attemptId as string;
    expect((await createAttempt(deps, guestId, versionId)).body.attemptId).toBe(attemptId);
    expect((await postAction(deps, guestId, attemptId, { revision: 0, action: { type: "continue" } })).status).toBe(200);
    expect(llm.requests).toHaveLength(0);
    expect((await getAttempt(deps, outsider.userId, attemptId)).status).toBe(404);
    expect((await guest.from("adventures_v3").select("id").eq("id", a.id)).data).toEqual([]);
    expect((await guest.rpc("set_adventure_public", { p_id: a.id, p_kind: "v3", p_public: false })).error?.code).toBe("42501");
    await owner.client.rpc("set_adventure_public", { p_id: a.id, p_kind: "v3", p_public: false });
    expect((await getAttempt(deps, guestId, attemptId)).status).toBe(404);
  });

  it("admits anonymous legacy players without membership and enforces attempt ownership", async () => {
    const a = await fixture("v2");
    const guest = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await guest.auth.signInAnonymously();
    expect(login.error).toBeNull();
    const guestId = login.data.user!.id;
    const join = () => guest.rpc("join_adventure", { p_token: a.share_token });
    expect((await join()).error?.code).toBe("42501");
    expect((await owner.client.rpc("set_adventure_public", { p_id: a.id, p_kind: "v2", p_public: true })).error).toBeNull();
    const first = await join();
    expect(first.error).toBeNull();
    expect(first.data).toEqual(expect.any(String));
    expect((await join()).data).toBe(first.data);
    expect((await admin.rpc("can_play_attempt", { p_attempt_id: first.data, p_user: guestId })).data).toBe(true);
    expect((await admin.rpc("can_play_attempt", { p_attempt_id: first.data, p_user: outsider.userId })).data).toBe(false);
    expect((await outsider.client.from("attempt").select("id").eq("id", first.data)).data).toEqual([]);
    expect((await guest.from("organization_member").select("user_id").eq("user_id", guestId)).data).toEqual([]);
    await owner.client.rpc("set_adventure_public", { p_id: a.id, p_kind: "v2", p_public: false });
    expect((await admin.rpc("can_play_attempt", { p_attempt_id: first.data, p_user: guestId })).data).toBe(false);
  });
});
