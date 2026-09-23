import { loadFixtureJson, I1_FIXTURE } from "@adventure/generation/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { getState } from "@/lib/play/service";
import { SupabasePlayStore } from "@/lib/play/store";
import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();
let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };
let otherStudent: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("maps-teacher"));
  student = await createUserClient(uniqueEmail("maps-student"));
  otherStudent = await createUserClient(uniqueEmail("maps-other-student"));
});

async function seedDraft(title: string) {
  const { data: adventure, error } = await admin.from("adventure").insert({ owner_id: teacher.userId, title, default_timer_seconds: 600 }).select("id, share_token").single();
  if (error) throw error;
  const version = await persistSpecVersion(admin, adventure.id, await loadFixtureJson(I1_FIXTURE.spec), { generatorVersion: "test", createdBy: teacher.userId });
  return { adventure, version };
}

async function publish(adventureId: string) {
  const result = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventureId });
  if (result.error) throw result.error;
  return result;
}

describe("version compiled maps", () => {
  it("persists private compiled maps, guards publication mutations, and denies client reads", async () => {
    const seeded = await seedDraft("Compiled maps");
    const stored = (await admin.from("spec_version").select("compiled_stages, compiled_spec").eq("id", seeded.version.specVersionId).single()).data!;
    expect(stored.compiled_spec).toBeTruthy();
    expect(stored.compiled_stages).toHaveLength(3);
    await publish(seeded.adventure.id);
    const mutation = await admin.from("spec_version").update({ compiled_stages: [] }).eq("id", seeded.version.specVersionId);
    expect(mutation.error).not.toBeNull();
    const studentRead = await student.client.from("spec_version").select("compiled_stages").eq("id", seeded.version.specVersionId).single();
    expect(studentRead.error).not.toBeNull();
    expect(studentRead.data).toBeNull();
    const teacherRead = await teacher.client.from("spec_version").select("compiled_stages").eq("id", seeded.version.specVersionId).single();
    expect(teacherRead.error).not.toBeNull();
    expect(teacherRead.data).toBeNull();
    const serviceRead = await admin.from("spec_version").select("compiled_stages").eq("id", seeded.version.specVersionId).single();
    expect(serviceRead.error).toBeNull();
    expect(serviceRead.data?.compiled_stages).toHaveLength(3);
  });

  it("loads the same stored map for two attempts and resumes from the published maps", async () => {
    const seeded = await seedDraft("Loaded maps");
    await publish(seeded.adventure.id);
    const first = await student.client.rpc("join_adventure", { p_token: seeded.adventure.share_token });
    const second = await otherStudent.client.rpc("join_adventure", { p_token: seeded.adventure.share_token });
    if (first.error) throw first.error;
    if (second.error) throw second.error;
    const store = new SupabasePlayStore(admin);
    const firstRecord = await store.load(first.data as string, student.userId);
    const secondRecord = await store.load(second.data as string, otherStudent.userId);
    expect(firstRecord?.compiledStages).toEqual(secondRecord?.compiledStages);
    const firstState = await getState({ store, llm: { complete: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0 } }) } }, first.data as string, student.userId);
    const secondState = await getState({ store, llm: { complete: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0 } }) } }, second.data as string, otherStudent.userId);
    const coldAgain = await getState({ store, llm: { complete: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0 } }) } }, first.data as string, student.userId);
    expect(coldAgain.ok).toBe(true);
    const privateRead = await student.client.from("spec_version").select("compiled_stages").eq("id", seeded.version.specVersionId).single();
    expect(privateRead.error).not.toBeNull();
    expect(privateRead.data).toBeNull();
    const publicRead = await student.client.from("spec_version").select("id, version").eq("id", seeded.version.specVersionId).single();
    expect(publicRead.error).toBeNull();
    expect(publicRead.data).toMatchObject({ id: seeded.version.specVersionId, version: 1 });
    expect(firstState.ok).toBe(true);
    expect(secondState.ok).toBe(true);
    if (firstState.ok && secondState.ok && coldAgain.ok) {
      expect(coldAgain.state.map).toEqual(firstState.state.map);
      expect(coldAgain.state.playerPos).toEqual(firstState.state.playerPos);
      expect(coldAgain.state.revision).toBe(firstState.state.revision);
      expect(firstState.state.map).toEqual(secondState.state.map);
      expect(firstState.state.mapArtifactId).toBe(secondState.state.mapArtifactId);
      expect(firstState.state.playerPos).toEqual(secondState.state.playerPos);
    }
  });

  it("returns incompatibility for a malformed stored spatial snapshot without saving or resetting", async () => {
    const seeded = await seedDraft("Malformed runtime");
    await publish(seeded.adventure.id);
    const joined = await student.client.rpc("join_adventure", { p_token: seeded.adventure.share_token });
    if (joined.error) throw joined.error;
    const store = new SupabasePlayStore(admin);
    const record = await store.load(joined.data as string, student.userId);
    const session = (await import("@/lib/play/session")).PlaySession.start(record!.spec, joined.data as string, 1, { now: () => new Date() }, record!.assets ?? null, record!.compiledStages);
    const malformed = session.snapshot();
    delete (malformed.world as { spatial?: unknown }).spatial;
    const memory = new (await import("@/lib/play/store")).MemoryPlayStore([{ ...record!, snapshot: malformed }]);
    const result = await getState({ store: memory, llm: { complete: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0 } }) } }, joined.data as string, student.userId);
    expect(result).toEqual({ ok: false, error: { code: "incompatible_version", message: "This attempt requires a new compatible adventure version." } });
    expect(memory.saved).toHaveLength(0);
  });

  it("inherits identical maps for clones and rejects changed or missing draft maps", async () => {
    const seeded = await seedDraft("Clone maps");
    await publish(seeded.adventure.id);
    const clone = await teacher.client.rpc("create_draft_version", { p_adventure_id: seeded.adventure.id });
    expect(clone.error).toBeNull();
    const versions = (await admin.from("spec_version").select("id, compiled_stages, compiled_spec").eq("adventure_id", seeded.adventure.id).order("version")).data!;
    expect(versions).toHaveLength(2);
    expect(versions[1]!.id).not.toBe(versions[0]!.id);
    expect(versions[1]!.compiled_stages).toEqual(versions[0]!.compiled_stages);
    expect(versions[1]!.compiled_spec).toEqual(versions[0]!.compiled_spec);
    await publish(seeded.adventure.id);

    const changed = await seedDraft("Changed maps");
    await admin.from("spec_version").update({ json: { ...(await loadFixtureJson(I1_FIXTURE.spec) as Record<string, unknown>), title: "changed" } }).eq("id", changed.version.specVersionId);
    const changedPublish = await teacher.client.rpc("publish_adventure", { p_adventure_id: changed.adventure.id });
    expect(changedPublish.error?.code).toBe("22023");

    const missing = await seedDraft("Missing maps");
    await admin.from("spec_version").update({ compiled_stages: null, compiled_spec: null }).eq("id", missing.version.specVersionId);
    const missingPublish = await teacher.client.rpc("publish_adventure", { p_adventure_id: missing.adventure.id });
    expect(missingPublish.error?.code).toBe("22023");
  });
});
