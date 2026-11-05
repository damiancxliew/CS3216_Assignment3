import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();
type Member = Awaited<ReturnType<typeof createUserClient>>;
let school: string, otherSchool: string;
let owner: Member, schoolAdmin: Member, student: Member, outsider: Member;
async function v3(title: string, status = "draft", schoolId = school) {
  const result = await admin.from("adventures_v3").insert({ school_id: schoolId, owner_id: owner.userId,
    title, status: "draft", spec: { title, stages: [{ timePlace: "Published setting" }] } }).select().single();
  if (result.error) throw result.error;
  if (status === "published") {
    const publication = await admin.rpc("publish_adventure_v3", { p_id: result.data.id,
      p_expected_version: 1, p_expected_published: null, p_publish: true });
    expect(publication.error).toBeNull();
    expect(publication.data).toBe(true);
  }
  return result.data.id as string;
}
async function v2(title: string) {
  const a = await admin.from("adventure").insert({ owner_id: owner.userId, organization_id: school, title }).select("id").single();
  if (a.error) throw a.error;
  const version = await admin.from("spec_version").insert({ adventure_id: a.data.id, version: 1, json: {}, generator_version: "shared-surfaces-test" }).select("id").single();
  if (version.error) throw version.error;
  expect((await admin.from("adventure").update({ status: "published", published_version: 1 }).eq("id", a.data.id)).error).toBeNull();
  return { id: a.data.id as string, versionId: version.data.id as string };
}
async function v3Attempt(adventureId: string, createdAt?: string) {
  const result = await admin.from("attempts_v3").insert({ adventure_id: adventureId, spec_version: 1,
    student_id: student.userId, state: {}, ...(createdAt ? { created_at: createdAt, updated_at: createdAt } : {}) }).select("id").single();
  if (result.error) throw result.error;
  return result.data.id as string;
}
async function library(who = student, includeV3 = true) {
  const result = await who.client.rpc("list_library_all_versions", { p_include_v3: includeV3 });
  expect(result.error).toBeNull();
  return result.data as Record<string, unknown>[];
}
async function archive(id: string, archived: boolean, who = schoolAdmin, schoolId = school) {
  return who.client.rpc("set_adventure_archived_v3", { p_org: schoolId, p_adventure_id: id, p_archived: archived });
}
async function completed(id: string, seq = 1, createdAt = new Date().toISOString()) {
  expect((await admin.from("attempt_events_v3").insert({ attempt_id: id, seq, type: "phase",
    payload: { to: "reveal", at: Date.parse(createdAt), stageIndex: 0 }, created_at: createdAt })).error).toBeNull();
}
beforeAll(async () => {
  school = await createOrganization("Shared surfaces");
  otherSchool = await createOrganization("Other shared surfaces");
  owner = await createUserClient(uniqueEmail("shared-owner"));
  schoolAdmin = await createUserClient(uniqueEmail("shared-admin"));
  student = await createUserClient(uniqueEmail("shared-student"));
  outsider = await createUserClient(uniqueEmail("shared-outsider"));
  for (const [who, org, role] of [[owner, school, "teacher"], [schoolAdmin, school, "admin"],
    [student, school, "student"], [outsider, otherSchool, "admin"]] as const) await addMember(org, who.userId, role);
});

describe("shared library and school usage", () => {
  it("lists both versions, uses published metadata after draft edits, and never exposes state/spec", async () => {
    const legacy = await v2("Legacy listing");
    const id = await v3("Published v3", "published");
    const draft = await v3("Secret unpublished draft");
    const foreign = await v3("Other school's story", "published", otherSchool);
    expect((await admin.rpc("save_adventure_v3", { p_id: id, p_expected_version: 1,
      p_spec: { title: "SECRET EDIT", stages: [{ timePlace: "SECRET SETTING" }] } })).error).toBeNull();
    const rows = await library();
    expect(rows).toContainEqual(expect.objectContaining({ adventure_id: legacy.id, kind: "v2" }));
    expect(rows).toContainEqual(expect.objectContaining({ adventure_id: id, kind: "v3", title: "Published v3", setting: "Published setting", published_version: 1 }));
    expect(rows.map(r => r.adventure_id)).not.toContain(draft);
    expect(rows.map(r => r.adventure_id)).not.toContain(foreign);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|"spec"|"state"/);
    const oversight = await schoolAdmin.client.rpc("school_usage_all_versions", { p_org: school, p_include_v3: true });
    expect(oversight.error).toBeNull();
    expect(oversight.data.find((row: { adventure_id: string }) => row.adventure_id === id).title).toBe("SECRET EDIT");
    expect((await library(student, false)).every(r => r.kind === "v2")).toBe(true);
    expect((await library(outsider)).map(r => r.adventure_id)).not.toContain(id);
    expect((await student.client.from("reporting_attempts_all_versions").select("*")).error).toBeTruthy();
  });

  it("exposes the current published version ID and never resumes an older version from the library", async () => {
    const id = await v3("Version-one link", "published");
    const olderAttempt = await v3Attempt(id);
    const original = (await library()).find(row => row.adventure_id === id)!;
    expect(original.latest_attempt_id).toBe(olderAttempt);
    expect(original.version_id).toEqual(expect.any(String));
    const saved = await admin.rpc("save_adventure_v3", { p_id: id, p_expected_version: 1,
      p_spec: { title: "Version-two link", stages: [{ timePlace: "New setting" }] } });
    expect(saved.error).toBeNull();
    expect((await admin.rpc("publish_adventure_v3", { p_id: id, p_expected_version: 2, p_expected_published: 1, p_publish: true })).error).toBeNull();
    const current = (await library()).find(row => row.adventure_id === id)!;
    expect(current).toMatchObject({ title: "Version-two link", published_version: 2, latest_attempt_id: null });
    expect(current.version_id).not.toBe(original.version_id);
    const publication = await admin.from("adventure_publications_v3").select("link_key").eq("adventure_id", id).eq("version", 2).single();
    expect(current.version_id).toBe(publication.data!.link_key);
    const store = new SupabaseV3PlayStore(admin);
    expect(await store.loadPublication(current.version_id as string)).toMatchObject({ id: current.version_id, adventureId: id, version: 2 });
    expect(await store.loadPublication(id)).toBeNull();
    expect(await store.loadPublication("invalid-version-id")).toBeNull();
    const usage = await schoolAdmin.client.rpc("school_usage_all_versions", { p_org: school, p_include_v3: true });
    expect(usage.error).toBeNull();
    expect(usage.data.find((row: { adventure_id: string }) => row.adventure_id === id)).toMatchObject({ version_id: current.version_id, shareable: true });
    const started = await admin.rpc("start_attempt_v3", { p_adventure_id: id, p_spec_version: 2,
      p_student_id: student.userId, p_state: {}, p_release: current.version_id });
    expect(started.error).toBeNull();
    expect((await library()).find(row => row.adventure_id === id)).toMatchObject({ latest_attempt_id: started.data.id, latest_attempt_status: "active" });
  });

  it("only returns the caller's attempt, resumes active attempts, and marks reveal as completed", async () => {
    const id = await v3("Progress listing", "published");
    const attempt = await v3Attempt(id);
    expect((await admin.from("attempts_v3").insert({ adventure_id: id, spec_version: 1, student_id: outsider.userId, state: {} })).error).toBeNull();
    expect((await library()).find(r => r.adventure_id === id)).toMatchObject({ latest_attempt_id: attempt, latest_attempt_status: "active", allow_retries: false });
    await completed(attempt);
    await completed(attempt, 2);
    expect((await library()).find(r => r.adventure_id === id)).toMatchObject({ latest_attempt_id: attempt, latest_attempt_status: "completed" });
    const result = await schoolAdmin.client.rpc("school_usage_all_versions", { p_org: school, p_include_v3: true });
    expect(result.error).toBeNull();
    expect(result.data).toContainEqual(expect.objectContaining({ adventure_id: id, kind: "v3", attempts: 2, students: 2,
      completed: 1, play_seconds: null, image_cost_usd: null, shareable: true }));
    for (const who of [student, outsider, owner]) {
      expect((await who.client.rpc("school_usage_all_versions", { p_org: school, p_include_v3: true })).error?.code).toBe("42501");
    }
  });

  it("archives atomically, restores the previous status, preserves pins, and denies cross-school changes", async () => {
    const id = await v3("Archive listing", "published");
    const attempt = await v3Attempt(id);
    expect((await archive(id, true)).data).toBe("archived");
    expect((await archive(id, true)).data).toBe("archived");
    expect((await library()).map(r => r.adventure_id)).not.toContain(id);
    expect((await admin.rpc("start_attempt_v3", { p_adventure_id: id, p_spec_version: 1, p_student_id: student.userId, p_state: {} })).data).toBeNull();
    expect((await archive(id, false)).data).toBe("published");
    expect((await admin.from("attempts_v3").select("spec_version").eq("id", attempt).single()).data?.spec_version).toBe(1);
    expect((await admin.from("adventures_v3").select("published_version,spec_version").eq("id", id).single()).data).toEqual({ published_version: 1, spec_version: 1 });
    for (const who of [student, outsider]) expect((await archive(id, true, who)).error?.code).toBe("42501");
    expect((await archive(id, true, schoolAdmin, otherSchool)).error?.code).toBe("P0002");
    const draft = await v3("Draft to archive");
    expect((await archive(draft, true, owner)).data).toBe("archived");
    expect((await archive(draft, false, owner)).data).toBe("draft");
    const legacy = await v3("Already archived");
    await admin.from("adventures_v3").update({ status: "archived" }).eq("id", legacy);
    expect((await archive(legacy, false)).data).toBe("draft");
    const generating = await v3("Still generating");
    await admin.from("adventures_v3").update({ status: "generating" }).eq("id", generating);
    expect((await archive(generating, true)).error?.code).toBe("22023");
  });

  it("hides discovery after membership removal", async () => {
    await addMember(school, student.userId, "student", "removed");
    try { expect(await library()).toEqual([]); }
    finally { await addMember(school, student.userId, "student"); }
  });
});

describe("combined platform reporting", () => {
  it("counts both versions, deduplicates students and completion events, and preserves shared LLM totals", async () => {
    const future = "2030-01-02T12:00:00Z";
    const since = "2030-01-02T00:00:00Z";
    const old = "2030-01-01T12:00:00Z";
    const initial = (await admin.rpc("platform_overview_all_versions", { p_since: since })).data[0];
    const legacy = await v2("Report legacy");
    const id = await v3("Report v3", "published");
    const v2Attempt = await admin.from("attempt").insert({ adventure_id: legacy.id, published_version: 1, student_id: student.userId,
      status: "completed", created_at: future, updated_at: future }).select("id").single();
    expect(v2Attempt.error).toBeNull();
    const recent = await v3Attempt(id, future);
    const older = await v3Attempt(id, old);
    await completed(recent, 1, future);
    await completed(recent, 2, future);
    await completed(older, 1, old);
    expect((await admin.from("llm_usage").insert({ purpose: "play", call: "shared-test", model: "test-no-price", organization_id: school,
      attempt_v3_id: recent, input_tokens: 123, output_tokens: 45, occurred_at: future })).error).toBeNull();
    const baseline = await admin.rpc("platform_overview", { p_since: since });
    const result = await admin.rpc("platform_overview_all_versions", { p_since: since });
    expect(result.error).toBeNull();
    for (const [key, increase] of Object.entries({ attempts_since: 2, completed_since: 2, active_students_since: 1, unmeasured_v3_attempts: 1 }))
      expect(Number(result.data[0][key]) - Number(initial[key])).toBe(increase);
    for (const key of ["llm_calls_since", "llm_tokens_since", "llm_cost_since", "image_cost_since", "play_seconds_since"])
      expect(result.data[0][key]).toEqual(baseline.data[0][key]);
    const stats = await admin.rpc("platform_school_stats_all_versions", { p_since: since });
    expect(stats.error).toBeNull();
    expect(stats.data.find((r: { organization_id: string }) => r.organization_id === school)).toMatchObject({ attempts_since: 2 });
    const schoolUsage = await schoolAdmin.client.rpc("school_usage_all_versions", { p_org: school, p_include_v3: true });
    expect(schoolUsage.error).toBeNull();
    expect(schoolUsage.data.find((r: { adventure_id: string }) => r.adventure_id === legacy.id)).toMatchObject({ version_students: 1 });
    expect((await student.client.rpc("platform_overview_all_versions", { p_since: since })).error?.code).toBe("42501");
  });

  it("reports daily completion once at first reveal and deduplicates activity across versions", async () => {
    const id = await v3("Daily metrics", "published");
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const attempt = await v3Attempt(id, yesterday);
    await completed(attempt, 1, yesterday);
    const since = `${today.slice(0, 10)}T00:00:00Z`;
    const before = await admin.rpc("platform_activity_daily_all_versions", { p_since: since });
    expect(before.error).toBeNull();
    await completed(attempt, 2, today);
    const after = await admin.rpc("platform_activity_daily_all_versions", { p_since: since });
    expect(after.error).toBeNull();
    expect(after.data[0].attempts_completed).toBe(before.data[0].attempts_completed);
    expect(after.data[0].active_students).toBeGreaterThanOrEqual(before.data[0].active_students);
  });
});
