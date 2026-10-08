import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { addMember, createOrganization, createUserClient, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();
const PASSWORD = "password123!";

type OverviewRow = {
  schools: number | string;
  admins: number | string;
  teachers: number | string;
  students: number | string;
  removed_students: number | string;
  sysadmins: number | string;
  adventures: number | string;
  published_adventures: number | string;
  attempts: number | string;
  attempts_since: number | string;
  completed_since: number | string;
  active_students_since: number | string;
  play_seconds_since: number | string;
  llm_calls_since: number | string;
  llm_tokens_since: number | string;
  llm_cost_since: number | string;
  unpriced_calls_since: number | string;
  image_cost_since: number | string;
};

type SchoolStatsRow = {
  organization_id: string;
  name: string;
  slug: string;
  admins: number | string;
  teachers: number | string;
  students: number | string;
  adventures: number | string;
  published: number | string;
  attempts: number | string;
  attempts_since: number | string;
  llm_cost_since: number | string;
  image_cost: number | string;
};

type DailyRow = {
  day: string;
  purpose: string;
  calls: number | string;
  tokens: number | string;
  cost_usd: number | string;
  unpriced_calls: number | string;
};

type MetricsSnapshot = {
  overview: OverviewRow;
  schools: SchoolStatsRow[];
  daily: DailyRow[];
};

async function metricsSnapshot(since: string): Promise<MetricsSnapshot> {
  const [overviewResult, schoolsResult, dailyResult] = await Promise.all([
    admin.rpc("platform_overview", { p_since: since }),
    admin.rpc("platform_school_stats", { p_since: since }),
    admin.rpc("platform_llm_daily", { p_since: since }),
  ]);
  expect(overviewResult.error).toBeNull();
  expect(schoolsResult.error).toBeNull();
  expect(dailyResult.error).toBeNull();
  return {
    overview: (overviewResult.data as unknown as OverviewRow[])[0]!,
    schools: schoolsResult.data as unknown as SchoolStatsRow[],
    daily: dailyResult.data as unknown as DailyRow[],
  };
}

async function createMember(
  organizationId: string,
  role: "admin" | "teacher" | "student",
  status: "active" | "removed" = "active",
) {
  const user = await createUserClient(uniqueEmail(`llm-usage-${role}`), PASSWORD);
  await addMember(organizationId, user.userId, role, status);
  return user;
}

async function createPublishedAdventure(ownerId: string, organizationId: string, title: string) {
  const { data: adventure, error } = await admin.from("adventure")
    .insert({ owner_id: ownerId, organization_id: organizationId, title })
    .select("id")
    .single();
  if (error) throw error;

  const { data: version, error: versionError } = await admin.from("spec_version")
    .insert({ adventure_id: adventure.id, version: 1, json: {}, generator_version: "llm-usage-test" })
    .select("id")
    .single();
  if (versionError) throw versionError;

  const { error: publishError } = await admin.from("adventure")
    .update({ status: "published", published_version: 1 })
    .eq("id", adventure.id);
  if (publishError) throw publishError;

  return { id: adventure.id, versionId: version.id };
}

function delta(after: number | string, before: number | string): number {
  return Number(after) - Number(before);
}

describe("LLM usage metrics", () => {
  it("fills attempt context and reports platform and school totals from the seeded rows", async () => {
    const since = new Date(Date.now() + 60_000).toISOString();
    const seededAt = new Date(Date.now() + 120_000).toISOString();
    const seededDay = seededAt.slice(0, 10);
    const before = await metricsSnapshot(since);

    const schoolA = await createOrganization("LLM Metrics A");
    const schoolB = await createOrganization("LLM Metrics B");
    await createMember(schoolA, "admin");
    const teacherA = await createMember(schoolA, "teacher");
    const studentA = await createMember(schoolA, "student");
    await createMember(schoolA, "student", "removed");
    await createMember(schoolB, "admin");
    const teacherB = await createMember(schoolB, "teacher");
    const studentB = await createMember(schoolB, "student");

    const adventureA = await createPublishedAdventure(teacherA.userId, schoolA, "Metrics adventure A");
    const adventureB = await createPublishedAdventure(teacherB.userId, schoolB, "Metrics adventure B");
    const { error: assetError } = await admin.from("asset").insert([
      {
        spec_version_id: adventureA.versionId,
        asset_id: "metrics-a",
        entity_id: "metrics-a",
        kind: "portrait",
        status: "ready",
        url: "https://assets.test/metrics-a.png",
        placeholder_url: "https://assets.test/placeholder.png",
        prompt_hash: "llm-usage-metrics-a",
        cost_usd: 0.01,
        updated_at: seededAt,
      },
      {
        spec_version_id: adventureB.versionId,
        asset_id: "metrics-b",
        entity_id: "metrics-b",
        kind: "portrait",
        status: "ready",
        url: "https://assets.test/metrics-b.png",
        placeholder_url: "https://assets.test/placeholder.png",
        prompt_hash: "llm-usage-metrics-b",
        cost_usd: 0.02,
        updated_at: seededAt,
      },
    ]);
    expect(assetError).toBeNull();

    const attemptA = crypto.randomUUID();
    const attemptB = crypto.randomUUID();
    const { error: attemptError } = await admin.from("attempt").insert([
      {
        id: attemptA,
        adventure_id: adventureA.id,
        published_version: 1,
        student_id: studentA.userId,
        status: "completed",
        created_at: seededAt,
        updated_at: seededAt,
      },
      {
        id: attemptB,
        adventure_id: adventureB.id,
        published_version: 1,
        student_id: studentB.userId,
        status: "active",
        created_at: seededAt,
        updated_at: seededAt,
      },
    ]);
    expect(attemptError).toBeNull();
    const { error: telemetryError } = await admin.from("attempt_telemetry").insert([
      { attempt_id: attemptA, stage_index: 0, ended_by: "decision", duration_seconds: 30, tokens: 40, recorded_at: seededAt },
      { attempt_id: attemptB, stage_index: 0, ended_by: "decision", duration_seconds: 30, tokens: 60, recorded_at: seededAt },
    ]);
    expect(telemetryError).toBeNull();

    const { data: contextUsage, error: contextError } = await admin.from("llm_usage")
      .insert({
        attempt_id: attemptA,
        purpose: "play",
        call: "character_turn",
        model: "unpriced-test-model",
        input_tokens: 3,
        output_tokens: 7,
        occurred_at: seededAt,
      })
      .select("adventure_id, user_id, organization_id")
      .single();
    expect(contextError).toBeNull();
    expect(contextUsage).toEqual({
      adventure_id: adventureA.id,
      user_id: studentA.userId,
      organization_id: schoolA,
    });

    const { error: usageError } = await admin.from("llm_usage").insert([
      {
        organization_id: schoolA,
        adventure_id: adventureA.id,
        user_id: teacherA.userId,
        purpose: "generation",
        call: "planner",
        model: "gpt-5.4",
        input_tokens: 100,
        cached_input_tokens: 30,
        output_tokens: 20,
        reasoning_tokens: 5,
        cost_usd: 0.01,
        occurred_at: seededAt,
      },
      {
        organization_id: schoolB,
        adventure_id: adventureB.id,
        user_id: teacherB.userId,
        purpose: "brief",
        call: "brief_turn",
        model: "gpt-5.4-mini",
        input_tokens: 50,
        cached_input_tokens: 0,
        output_tokens: 10,
        reasoning_tokens: 0,
        cost_usd: 0.02,
        occurred_at: seededAt,
      },
    ]);
    expect(usageError).toBeNull();

    const after = await metricsSnapshot(since);
    for (const value of Object.values(after.overview)) {
      expect(Number.isFinite(Number(value))).toBe(true);
      expect(Number(value)).toBeGreaterThanOrEqual(0);
    }
    expect(delta(after.overview.llm_calls_since, before.overview.llm_calls_since)).toBe(3);
    expect(delta(after.overview.llm_tokens_since, before.overview.llm_tokens_since)).toBe(190);
    expect(delta(after.overview.unpriced_calls_since, before.overview.unpriced_calls_since)).toBe(1);
    expect(Number(after.overview.llm_cost_since) - Number(before.overview.llm_cost_since)).toBeCloseTo(0.03, 6);

    const statsA = after.schools.find((school) => school.organization_id === schoolA);
    const statsB = after.schools.find((school) => school.organization_id === schoolB);
    expect(statsA).toMatchObject({
      admins: 1, teachers: 1, students: 1, adventures: 1, published: 1, attempts: 1, attempts_since: 1,
    });
    expect(Number(statsA?.llm_cost_since)).toBeCloseTo(0.01, 6);
    expect(Number(statsA?.image_cost)).toBeCloseTo(0.01, 6);
    expect(statsB).toMatchObject({
      admins: 1, teachers: 1, students: 1, adventures: 1, published: 1, attempts: 1, attempts_since: 1,
    });
    expect(Number(statsB?.llm_cost_since)).toBeCloseTo(0.02, 6);
    expect(Number(statsB?.image_cost)).toBeCloseTo(0.02, 6);

    const expectedDaily = [
      { purpose: "brief", calls: 1, tokens: 60, cost: 0.02, unpriced: 0 },
      { purpose: "generation", calls: 1, tokens: 120, cost: 0.01, unpriced: 0 },
      { purpose: "play", calls: 1, tokens: 10, cost: 0, unpriced: 1 },
    ];
    for (const expected of expectedDaily) {
      const row = after.daily.find((daily) => daily.day === seededDay && daily.purpose === expected.purpose);
      const prior = before.daily.find((daily) => daily.day === seededDay && daily.purpose === expected.purpose);
      expect(delta(row?.calls ?? 0, prior?.calls ?? 0)).toBe(expected.calls);
      expect(delta(row?.tokens ?? 0, prior?.tokens ?? 0)).toBe(expected.tokens);
      expect(delta(row?.unpriced_calls ?? 0, prior?.unpriced_calls ?? 0)).toBe(expected.unpriced);
      expect(Number(row?.cost_usd ?? 0) - Number(prior?.cost_usd ?? 0)).toBeCloseTo(expected.cost, 6);
    }

    const unauthorized: { client: SupabaseClient } = await createUserClient(uniqueEmail("llm-usage-denied"), PASSWORD);
    const denied = await unauthorized.client.rpc("platform_overview", { p_since: since });
    expect(denied.error?.code).toBe("42501");
  });
});
