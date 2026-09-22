/**
 * P4 — publish + immutable versioning. A published version is frozen against
 * every role; editing after publish means a new draft version; and the one
 * thing that must never happen — a teacher's edit reaching into a game already
 * in progress — is asserted directly.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { loadI1Spec } from "@adventure/generation/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

type Fixture = {
  adventureId: string;
  specVersionId: string;
  stageId: string;
  roomId: string;
  agentId: string;
  optionId: string;
};

/** A one-stage draft adventure, unpublished. */
async function seedDraft(teacherId: string): Promise<Fixture> {
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({ owner_id: teacherId, title: "The strait", default_timer_seconds: 600 })
    .select("id")
    .single();
  if (error) throw error;

  const { data: specVersion, error: specError } = await admin
    .from("spec_version")
    .insert({
      adventure_id: adventure.id,
      version: 1,
      json: { stages: ["v1"] },
      generator_version: "test",
    })
    .select("id")
    .single();
  if (specError) throw specError;

  const { data: stage, error: stageError } = await admin
    .from("stage")
    .insert({
      spec_version_id: specVersion.id,
      index: 0,
      title: "The vote",
      shared_context: "The fleet is three days out.",
    })
    .select("id")
    .single();
  if (stageError) throw stageError;

  const { data: room, error: roomError } = await admin
    .from("room")
    .insert({ stage_id: stage.id, name: "Chamber" })
    .select("id")
    .single();
  if (roomError) throw roomError;

  const { data: agent, error: agentError } = await admin
    .from("agent")
    .insert({
      stage_id: stage.id,
      name: "Envoy Marisel",
      public_position: "Keep the strait open.",
      start_room_id: room.id,
    })
    .select("id")
    .single();
  if (agentError) throw agentError;

  const { error: contextError } = await admin
    .from("agent_private_context")
    .insert({ agent_id: agent.id, private_context: "Bankrolled by the merchants." });
  if (contextError) throw contextError;

  const { data: option, error: optionError } = await admin
    .from("decision_option")
    .insert({ stage_id: stage.id, label: "Vote for the blockade" })
    .select("id")
    .single();
  if (optionError) throw optionError;

  return {
    adventureId: adventure.id,
    specVersionId: specVersion.id,
    stageId: stage.id,
    roomId: room.id,
    agentId: agent.id,
    optionId: option.id,
  };
}

let teacher: SupabaseClient;
let teacherId: string;
let otherTeacher: SupabaseClient;
let student: SupabaseClient;
let fixture: Fixture;

beforeEach(async () => {
  const t = await createUserClient(uniqueEmail("p4-teacher"));
  const o = await createUserClient(uniqueEmail("p4-other"));
  const s = await createUserClient(uniqueEmail("p4-student"));
  teacher = t.client;
  teacherId = t.userId;
  otherTeacher = o.client;
  student = s.client;
  fixture = await seedDraft(t.userId);
});

describe("publish_adventure", () => {
  it("stamps the draft and points the adventure at it", async () => {
    const { data: version, error } = await teacher.rpc("publish_adventure", {
      p_adventure_id: fixture.adventureId,
    });
    expect(error).toBeNull();
    expect(version).toBe(1);

    const { data: adventure } = await admin
      .from("adventure")
      .select("status, published_version")
      .eq("id", fixture.adventureId)
      .single();
    expect(adventure).toMatchObject({ status: "published", published_version: 1 });
  });

  it("refuses a teacher who does not own the adventure", async () => {
    const { error } = await otherTeacher.rpc("publish_adventure", {
      p_adventure_id: fixture.adventureId,
    });
    expect(error).not.toBeNull();
  });

  it("refuses when there is nothing new to publish", async () => {
    await teacher.rpc("publish_adventure", { p_adventure_id: fixture.adventureId });
    const { error } = await teacher.rpc("publish_adventure", {
      p_adventure_id: fixture.adventureId,
    });
    expect(error).not.toBeNull();
  });
});

describe("a published version is frozen", () => {
  beforeEach(async () => {
    const { error } = await teacher.rpc("publish_adventure", {
      p_adventure_id: fixture.adventureId,
    });
    expect(error).toBeNull();
  });

  // The service role is the strongest writer in the system — the generation
  // pipeline and every route handler run as it — so freezing has to hold here
  // or it does not hold at all.
  it.each([
    ["spec_version", () => admin.from("spec_version").update({ json: { stages: ["hacked"] } }).eq("id", fixture.specVersionId)],
    ["stage", () => admin.from("stage").update({ title: "Rewritten" }).eq("id", fixture.stageId)],
    ["room", () => admin.from("room").update({ name: "Annex" }).eq("id", fixture.roomId)],
    ["agent", () => admin.from("agent").update({ public_position: "Close the strait." }).eq("id", fixture.agentId)],
    ["agent_private_context", () => admin.from("agent_private_context").update({ private_context: "New motive." }).eq("agent_id", fixture.agentId)],
    ["decision_option", () => admin.from("decision_option").update({ label: "Abstain" }).eq("id", fixture.optionId)],
  ])("rejects an update to %s", async (_table, mutate) => {
    const { error } = await mutate();
    expect(error).not.toBeNull();
  });

  it("rejects new rows hung off a published stage", async () => {
    const { error } = await admin
      .from("decision_option")
      .insert({ stage_id: fixture.stageId, label: "Smuggled in after publish" });
    expect(error).not.toBeNull();
  });

  it("rejects deleting the published version", async () => {
    const { error } = await admin
      .from("spec_version")
      .delete()
      .eq("id", fixture.specVersionId);
    expect(error).not.toBeNull();

    const { data } = await admin
      .from("spec_version")
      .select("id")
      .eq("id", fixture.specVersionId);
    expect(data ?? []).toHaveLength(1);
  });
});

describe("create_draft_version", () => {
  beforeEach(async () => {
    await teacher.rpc("publish_adventure", { p_adventure_id: fixture.adventureId });
  });

  it("copies the published version into an editable draft", async () => {
    const { data: version, error } = await teacher.rpc("create_draft_version", {
      p_adventure_id: fixture.adventureId,
    });
    expect(error).toBeNull();
    expect(version).toBe(2);

    const { data: draft } = await admin
      .from("spec_version")
      .select("id, published_at, json")
      .eq("adventure_id", fixture.adventureId)
      .eq("version", 2)
      .single();
    expect(draft!.published_at).toBeNull();
    expect(draft!.json).toEqual({ stages: ["v1"] });

    // The copy is a copy, not a second reference: its stage is editable and
    // the published stage is untouched by the edit.
    const { data: draftStage } = await admin
      .from("stage")
      .select("id, title")
      .eq("spec_version_id", draft!.id)
      .single();
    expect(draftStage!.id).not.toBe(fixture.stageId);

    const { error: editError } = await admin
      .from("stage")
      .update({ title: "The second vote" })
      .eq("id", draftStage!.id);
    expect(editError).toBeNull();

    const { data: publishedStage } = await admin
      .from("stage")
      .select("title")
      .eq("id", fixture.stageId)
      .single();
    expect(publishedStage!.title).toBe("The vote");
  });

  it("rewrites internal references to point inside the copy", async () => {
    await teacher.rpc("create_draft_version", { p_adventure_id: fixture.adventureId });

    const { data: draft } = await admin
      .from("spec_version")
      .select("id")
      .eq("adventure_id", fixture.adventureId)
      .eq("version", 2)
      .single();
    const { data: draftStage } = await admin
      .from("stage")
      .select("id")
      .eq("spec_version_id", draft!.id)
      .single();
    const { data: draftRoom } = await admin
      .from("room")
      .select("id")
      .eq("stage_id", draftStage!.id)
      .single();
    const { data: draftAgent } = await admin
      .from("agent")
      .select("id, start_room_id")
      .eq("stage_id", draftStage!.id)
      .single();

    expect(draftAgent!.start_room_id).toBe(draftRoom!.id);
    expect(draftAgent!.start_room_id).not.toBe(fixture.roomId);

    const { data: draftContext } = await admin
      .from("agent_private_context")
      .select("private_context")
      .eq("agent_id", draftAgent!.id)
      .single();
    expect(draftContext!.private_context).toBe("Bankrolled by the merchants.");
  });

  it("copies every authored spec_id from the valid I1 fixture", async () => {
    const { data: adventure, error: adventureError } = await admin
      .from("adventure")
      .insert({ owner_id: teacherId, title: "Singapore fixture" })
      .select("id")
      .single();
    if (adventureError) throw adventureError;
    const spec = await loadI1Spec();
    const persisted = await persistSpecVersion(admin, adventure.id, spec, {
      generatorVersion: "test",
      createdBy: teacherId,
    });
    const published = await teacher.rpc("publish_adventure", { p_adventure_id: adventure.id });
    expect(published.error).toBeNull();
    expect(published.data).toBe(1);

    const drafted = await teacher.rpc("create_draft_version", { p_adventure_id: adventure.id });
    expect(drafted.error).toBeNull();
    expect(drafted.data).toBe(2);

    const versionRows = async (version: number) => {
      const { data: versionRow, error: versionError } = await admin
        .from("spec_version")
        .select("id")
        .eq("adventure_id", adventure.id)
        .eq("version", version)
        .single();
      if (versionError) throw versionError;
      const { data: stages, error: stageError } = await admin
        .from("stage")
        .select("id, spec_id")
        .eq("spec_version_id", versionRow.id)
        .order("index");
      if (stageError) throw stageError;
      const stageIds = stages!.map((stage) => stage.id);
      const children = async (table: string) => {
        const { data, error } = await admin
          .from(table)
          .select("spec_id")
          .in("stage_id", stageIds);
        if (error) throw error;
        return data!.map((row) => row.spec_id);
      };
      return {
        stages: stages!.map((stage) => stage.spec_id),
        rooms: await children("room"),
        agents: await children("agent"),
        evidence: await children("evidence"),
        objectives: await children("objective"),
        options: await children("decision_option"),
      };
    };

    const expected = {
      stages: spec.stages.map((stage) => stage.id),
      rooms: spec.stages.flatMap((stage) => stage.rooms.map((room) => room.id)),
      agents: spec.stages.flatMap((stage) => stage.agents.map((agent) => agent.id)),
      evidence: spec.stages.flatMap((stage) => stage.evidence.map((item) => item.id)),
      objectives: spec.stages.flatMap((stage) => stage.objectives.map((item) => item.id)),
      options: spec.stages.flatMap((stage) => stage.decision.options.map((option) => option.id)),
    };
    for (const version of [1, 2]) {
      const actual = await versionRows(version);
      expect(actual.stages.every((id) => id !== null)).toBe(true);
      expect(actual.rooms.every((id) => id !== null)).toBe(true);
      expect(actual.agents.every((id) => id !== null)).toBe(true);
      expect(actual.evidence.every((id) => id !== null)).toBe(true);
      expect(actual.objectives.every((id) => id !== null)).toBe(true);
      expect(actual.options.every((id) => id !== null)).toBe(true);
      expect(actual.stages.sort()).toEqual(expected.stages.sort());
      expect(actual.rooms.sort()).toEqual(expected.rooms.sort());
      expect(actual.agents.sort()).toEqual(expected.agents.sort());
      expect(actual.evidence.sort()).toEqual(expected.evidence.sort());
      expect(actual.objectives.sort()).toEqual(expected.objectives.sort());
      expect(actual.options.sort()).toEqual(expected.options.sort());
    }

    expect(persisted.specVersionId).toBeTruthy();
  });

  it("refuses a second draft and a teacher who does not own the adventure", async () => {
    await teacher.rpc("create_draft_version", { p_adventure_id: fixture.adventureId });

    const again = await teacher.rpc("create_draft_version", {
      p_adventure_id: fixture.adventureId,
    });
    expect(again.error).not.toBeNull();

    const foreign = await otherTeacher.rpc("create_draft_version", {
      p_adventure_id: fixture.adventureId,
    });
    expect(foreign.error).not.toBeNull();
  });
});

describe("an in-flight attempt", () => {
  it("is unaffected by a teacher publishing an edited version", async () => {
    await teacher.rpc("publish_adventure", { p_adventure_id: fixture.adventureId });

    const { data: token } = await admin
      .from("adventure")
      .select("share_token")
      .eq("id", fixture.adventureId)
      .single();
    const { data: attemptId, error: joinError } = await student.rpc("join_adventure", {
      p_token: token!.share_token,
    });
    expect(joinError).toBeNull();

    // The teacher rewrites the adventure and republishes, mid-game.
    await teacher.rpc("create_draft_version", { p_adventure_id: fixture.adventureId });
    const { data: draft } = await admin
      .from("spec_version")
      .select("id")
      .eq("adventure_id", fixture.adventureId)
      .eq("version", 2)
      .single();
    const { data: draftStage } = await admin
      .from("stage")
      .select("id")
      .eq("spec_version_id", draft!.id)
      .single();
    await admin
      .from("stage")
      .update({ title: "Everything is different now" })
      .eq("id", draftStage!.id);
    const { data: republished } = await teacher.rpc("publish_adventure", {
      p_adventure_id: fixture.adventureId,
    });
    expect(republished).toBe(2);

    // The attempt still plays version 1, on version 1's stage.
    const { data: attempt } = await admin
      .from("attempt")
      .select("published_version, current_stage_id")
      .eq("id", attemptId)
      .single();
    expect(attempt).toMatchObject({
      published_version: 1,
      current_stage_id: fixture.stageId,
    });

    // And the student sees version 1's content, not the teacher's rewrite.
    const { data: visibleStages } = await student
      .from("stage")
      .select("id, title")
      .eq("spec_version_id", fixture.specVersionId);
    expect(visibleStages).toEqual([{ id: fixture.stageId, title: "The vote" }]);

    const { data: hidden } = await student
      .from("stage")
      .select("id")
      .eq("spec_version_id", draft!.id);
    expect(hidden ?? []).toHaveLength(0);
  });

  it("keeps a teacher from reaching a second teacher's adventure at all", async () => {
    const theirs = await seedDraft(teacherId);
    const { error } = await otherTeacher.rpc("publish_adventure", {
      p_adventure_id: theirs.adventureId,
    });
    expect(error).not.toBeNull();
  });
});
