/**
 * stageBelongsTo/agentBelongsTo: a stage or agent id is only writable through
 * the adventure that owns its spec version — defence-in-depth for the
 * service-role writes in the teacher actions.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { agentBelongsTo, stageBelongsTo } from "@/lib/adventures/ownership";
import { createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

type Fixture = { teacherId: string; adventureId: string; stageId: string; agentId: string };

async function insert<T extends Record<string, unknown>>(table: string, row: T): Promise<{ id: string }> {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as { id: string };
}

async function seedAdventure(teacherId: string, title: string): Promise<Fixture> {
  const adventure = await insert("adventure", { owner_id: teacherId, title, status: "draft" });
  const specVersion = await insert("spec_version", {
    adventure_id: adventure.id,
    version: 1,
    json: { stages: [] },
    generator_version: "test",
  });
  const stage = await insert("stage", { spec_version_id: specVersion.id, index: 0, title: "The vote" });
  const room = await insert("room", { stage_id: stage.id, name: "Chamber" });
  const agent = await insert("agent", { stage_id: stage.id, name: "Envoy", start_room_id: room.id });
  return { teacherId, adventureId: adventure.id, stageId: stage.id, agentId: agent.id };
}

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  const teacherA = await createUserClient(uniqueEmail("own-a"));
  const teacherB = await createUserClient(uniqueEmail("own-b"));
  a = await seedAdventure(teacherA.userId, "Adventure A");
  b = await seedAdventure(teacherB.userId, "Adventure B");
});

describe("stageBelongsTo", () => {
  it("is true for the owning adventure only", async () => {
    expect(await stageBelongsTo(admin, a.adventureId, a.stageId)).toBe(true);
    expect(await stageBelongsTo(admin, a.adventureId, b.stageId)).toBe(false);
    expect(await stageBelongsTo(admin, b.adventureId, a.stageId)).toBe(false);
    expect(await stageBelongsTo(admin, a.adventureId, randomUUID())).toBe(false);
  });
});

describe("agentBelongsTo", () => {
  it("is true for the owning adventure only", async () => {
    expect(await agentBelongsTo(admin, a.adventureId, a.agentId)).toBe(true);
    expect(await agentBelongsTo(admin, a.adventureId, b.agentId)).toBe(false);
    expect(await agentBelongsTo(admin, b.adventureId, a.agentId)).toBe(false);
    expect(await agentBelongsTo(admin, a.adventureId, randomUUID())).toBe(false);
  });
});
