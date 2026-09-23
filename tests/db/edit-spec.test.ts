import { loadFixtureJson, I1_FIXTURE } from "@adventure/generation/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { applySpecEdit } from "@/lib/teacher/edit-spec";
import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();
let teacher: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("editspec-teacher"));
});

async function seedDraft(title: string) {
  const { data: adventure, error } = await admin.from("adventure").insert({ owner_id: teacher.userId, title, default_timer_seconds: 600 }).select("id").single();
  if (error) throw error;
  const version = await persistSpecVersion(admin, adventure.id, await loadFixtureJson(I1_FIXTURE.spec), { generatorVersion: "test", createdBy: teacher.userId });
  return { adventure, version };
}

describe("dossier edits", () => {
  it("patches the draft json, re-stamps compiled_spec, mirrors the stage row and still publishes", async () => {
    const { adventure, version } = await seedDraft("Editable draft");
    const specId = version.specVersionId;
    const stageId = (await admin.from("stage").select("spec_id").eq("spec_version_id", specId).order("index").limit(1).single()).data!.spec_id!;

    const result = await applySpecEdit(admin, { adventureId: adventure.id, specVersionId: specId }, {
      kind: "stage",
      stageId,
      title: "Retitled opening stage",
      sharedContext: "A rewritten shared context.",
      timerSeconds: 120,
    });
    expect(result.error).toBeUndefined();

    const stored = (await admin.from("spec_version").select("json, compiled_spec").eq("id", specId).single()).data!;
    expect(stored.json.stages[0].title).toBe("Retitled opening stage");
    expect(stored.json.stages[0].shared_context ?? stored.json.stages[0].sharedContext?.text).toBe("A rewritten shared context.");
    expect(stored.compiled_spec).toEqual(stored.json);

    const stageRow = (await admin.from("stage").select("title, shared_context, timer_seconds").eq("spec_version_id", specId).eq("spec_id", stageId).single()).data!;
    expect(stageRow.title).toBe("Retitled opening stage");
    expect(stageRow.shared_context).toBe("A rewritten shared context.");
    expect(stageRow.timer_seconds).toBe(120);

    const publish = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure.id });
    expect(publish.error).toBeNull();
  });

  it("refuses to touch a published version and changes nothing", async () => {
    const { adventure, version } = await seedDraft("Frozen draft");
    const publish = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure.id });
    if (publish.error) throw publish.error;
    const specId = version.specVersionId;
    const before = (await admin.from("spec_version").select("json, compiled_stages").eq("id", specId).single()).data!;
    const stageId = before.json.stages[0].id;

    const result = await applySpecEdit(admin, { adventureId: adventure.id, specVersionId: specId }, {
      kind: "stage",
      stageId,
      title: "Must not land",
      sharedContext: "Must not land.",
      timerSeconds: null,
    });
    expect(result.error).toContain("published and frozen");

    const after = (await admin.from("spec_version").select("json, compiled_stages").eq("id", specId).single()).data!;
    expect(after.json).toEqual(before.json);
    expect(after.compiled_stages).toEqual(before.compiled_stages);
  });
});
