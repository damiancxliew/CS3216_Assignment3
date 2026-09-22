/**
 * P5 — the authoring write path. A teacher never touches the database, so the
 * console writes a generated spec into relational rows on their behalf. What
 * this proves: the I1 fixture round-trips into stages/rooms/agents/evidence
 * with references rewritten to uuids, an invalid spec writes nothing at all,
 * the private half of a stakeholder lands only in the deny-all table, and a
 * second import is refused while an unpublished draft is open (P4).
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { loadFixtureJson, I1_FIXTURE } from "@adventure/generation/fixtures";
import type { AdventureSpec } from "@adventure/generation/spec";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import {
  persistSpecVersion,
  SpecPersistError,
} from "@/lib/adventures/persist-spec";

const admin = serviceClient();

let spec: Record<string, unknown>;
let fixtureSpec: AdventureSpec;
let teacherId: string;

async function newAdventure(): Promise<string> {
  const { data, error } = await admin
    .from("adventure")
    .insert({ owner_id: teacherId, title: "Singapore, 1819" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  fixtureSpec = (await loadFixtureJson(I1_FIXTURE.spec)) as AdventureSpec;
  spec = fixtureSpec as unknown as Record<string, unknown>;
  const teacher = await createUserClient(uniqueEmail("p5-teacher"));
  teacherId = teacher.userId;
});

describe("persistSpecVersion", () => {
  it("writes the fixture spec as draft v1 with its stages and rooms", async () => {
    const adventureId = await newAdventure();
    const result = await persistSpecVersion(admin, adventureId, spec, {
      generatorVersion: "test",
      createdBy: teacherId,
    });

    expect(result.version).toBe(1);

    const { data: version } = await admin
      .from("spec_version")
      .select("version, published_at")
      .eq("id", result.specVersionId)
      .single();
    expect(version!.version).toBe(1);
    expect(version!.published_at).toBeNull();

    const { data: stages } = await admin
      .from("stage")
      .select("id, index, title, spec_id")
      .eq("spec_version_id", result.specVersionId)
      .order("index");
    expect(stages).toHaveLength(3);
    expect(stages!.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(stages!.map((s) => s.spec_id)).toEqual(fixtureSpec.stages.map((stage) => stage.id));

    const { data: rooms } = await admin
      .from("room")
      .select("id, spec_id, stage_id")
      .in("stage_id", stages!.map((s) => s.id));
    expect(rooms!.map((room) => room.spec_id).sort()).toEqual(
      fixtureSpec.stages.flatMap((stage) => stage.rooms.map((room) => room.id)).sort(),
    );
  });

  it("rewrites agent, evidence and branch references to database uuids", async () => {
    const adventureId = await newAdventure();
    const { specVersionId, ids } = await persistSpecVersion(
      admin,
      adventureId,
      spec,
      { generatorVersion: "test" },
    );

    const { data: stages } = await admin
      .from("stage")
      .select("id, branch_map")
      .eq("spec_version_id", specVersionId)
      .order("index");
    const stageIds = new Set(stages!.map((s) => s.id));

    // An agent starts in a room of its own stage, by uuid, not by spec slug.
    const { data: agents } = await admin
      .from("agent")
      .select("id, spec_id, start_room_id, stage_id")
      .in("stage_id", [...stageIds]);
    expect(agents!.map((agent) => agent.spec_id).sort()).toEqual(
      fixtureSpec.stages.flatMap((stage) => stage.agents.map((agent) => agent.id)).sort(),
    );
    for (const agent of agents!) {
      const { data: room } = await admin
        .from("room")
        .select("stage_id")
        .eq("id", agent.start_room_id)
        .single();
      expect(room!.stage_id).toBe(agent.stage_id);
    }

    const { data: evidence } = await admin
      .from("evidence")
      .select("spec_id, stage_id")
      .in("stage_id", [...stageIds]);
    expect(evidence!.map((item) => item.spec_id).sort()).toEqual(
      fixtureSpec.stages.flatMap((stage) => stage.evidence.map((item) => item.id)).sort(),
    );

    const { data: objectives } = await admin
      .from("objective")
      .select("spec_id, stage_id")
      .in("stage_id", [...stageIds]);
    expect(objectives!.map((objective) => objective.spec_id).sort()).toEqual(
      fixtureSpec.stages.flatMap((stage) => stage.objectives.map((objective) => objective.id)).sort(),
    );

    const { data: options } = await admin
      .from("decision_option")
      .select("spec_id, stage_id")
      .in("stage_id", [...stageIds]);
    expect(options!.map((option) => option.spec_id).sort()).toEqual(
      fixtureSpec.stages.flatMap((stage) => stage.decision.options.map((option) => option.id)).sort(),
    );

    // Every branch target is either a stage uuid in this version or an ending.
    for (const stage of stages!) {
      const branches = Object.values(
        stage.branch_map as Record<string, { kind: string; stageId?: string }>,
      );
      expect(branches.length).toBeGreaterThan(0);
      for (const branch of branches) {
        if (branch.kind === "stage") expect(stageIds.has(branch.stageId!)).toBe(true);
      }
    }

    // Slugs never leak into the relational rows.
    for (const uuid of ids.values()) {
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it("keeps the private half of a stakeholder out of the readable table", async () => {
    const adventureId = await newAdventure();
    const { specVersionId } = await persistSpecVersion(admin, adventureId, spec, {
      generatorVersion: "test",
    });

    const { data: stages } = await admin
      .from("stage")
      .select("id")
      .eq("spec_version_id", specVersionId);
    const { data: agents } = await admin
      .from("agent")
      .select("id, name, public_position")
      .in("stage_id", stages!.map((s) => s.id));

    const { data: contexts } = await admin
      .from("agent_private_context")
      .select("agent_id, private_context, knowledge_horizon")
      .in("agent_id", agents!.map((a) => a.id));
    expect(contexts).toHaveLength(agents!.length);
    for (const context of contexts!) {
      expect(context.private_context.length).toBeGreaterThan(0);
      expect(context.knowledge_horizon.length).toBeGreaterThan(0);
    }

    // Nothing private bled into the column a student may read.
    const horizons = contexts!.map((c) => c.knowledge_horizon);
    for (const agent of agents!) {
      expect(horizons).not.toContain(agent.public_position);
    }
  });

  it("persists nothing when the spec is invalid", async () => {
    const adventureId = await newAdventure();
    const broken = { ...spec, stages: [] };

    await expect(
      persistSpecVersion(admin, adventureId, broken, { generatorVersion: "test" }),
    ).rejects.toBeInstanceOf(SpecPersistError);

    const { count } = await admin
      .from("spec_version")
      .select("id", { count: "exact", head: true })
      .eq("adventure_id", adventureId);
    expect(count).toBe(0);
  });

  it("refuses a second import while an unpublished draft is open", async () => {
    const adventureId = await newAdventure();
    await persistSpecVersion(admin, adventureId, spec, { generatorVersion: "test" });

    await expect(
      persistSpecVersion(admin, adventureId, spec, { generatorVersion: "test" }),
    ).rejects.toThrow(/unpublished draft/);
  });

  it("imports as the next version once the previous one is published", async () => {
    const adventureId = await newAdventure();
    await persistSpecVersion(admin, adventureId, spec, { generatorVersion: "test" });

    const teacher = await createUserClient(uniqueEmail("p5-publisher"));
    await admin.from("adventure").update({ owner_id: teacher.userId }).eq("id", adventureId);
    const { error } = await teacher.client.rpc("publish_adventure", {
      p_adventure_id: adventureId,
    });
    expect(error).toBeNull();

    const second = await persistSpecVersion(admin, adventureId, spec, {
      generatorVersion: "test",
    });
    expect(second.version).toBe(2);
  });
});
