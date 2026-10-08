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

async function addModelPrice(model: string, input: number, cachedInput: number, output: number) {
  const { error } = await admin.from("model_price").insert({
    model,
    input_usd_per_mtok: input,
    cached_input_usd_per_mtok: cachedInput,
    output_usd_per_mtok: output,
  });
  expect(error).toBeNull();
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

function expectDailyDelta(
  after: MetricsSnapshot,
  before: MetricsSnapshot,
  day: string,
  purpose: string,
  expected: { calls: number; tokens: number; cost: number; unpriced: number },
) {
  const row = after.daily.find((daily) => daily.day === day && daily.purpose === purpose);
  const prior = before.daily.find((daily) => daily.day === day && daily.purpose === purpose);
  expect(delta(row?.calls ?? 0, prior?.calls ?? 0)).toBe(expected.calls);
  expect(delta(row?.tokens ?? 0, prior?.tokens ?? 0)).toBe(expected.tokens);
  expect(delta(row?.unpriced_calls ?? 0, prior?.unpriced_calls ?? 0)).toBe(expected.unpriced);
  expect(Number(row?.cost_usd ?? 0) - Number(prior?.cost_usd ?? 0)).toBeCloseTo(expected.cost, 9);
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

    const modelA = `test-model-${crypto.randomUUID()}`;
    const modelB = `test-model-${crypto.randomUUID()}`;
    const unpricedModel = `unpriced-test-model-${crypto.randomUUID()}`;
    await addModelPrice(modelA, 2, 1, 3);
    await addModelPrice(modelB, 2, 1, 3);

    const { data: contextUsage, error: contextError } = await admin.from("llm_usage")
      .insert({
        attempt_id: attemptA,
        purpose: "play",
        call: "character_turn",
        model: unpricedModel,
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
        model: modelA,
        input_tokens: 100,
        cached_input_tokens: 30,
        output_tokens: 20,
        reasoning_tokens: 5,
        occurred_at: seededAt,
      },
      {
        organization_id: schoolB,
        adventure_id: adventureB.id,
        user_id: teacherB.userId,
        purpose: "brief",
        call: "brief_turn",
        model: modelB,
        input_tokens: 50,
        cached_input_tokens: 0,
        output_tokens: 10,
        reasoning_tokens: 0,
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
    expect(Number(after.overview.llm_cost_since) - Number(before.overview.llm_cost_since)).toBeCloseTo(0.00036, 9);

    const statsA = after.schools.find((school) => school.organization_id === schoolA);
    const statsB = after.schools.find((school) => school.organization_id === schoolB);
    expect(statsA).toMatchObject({
      admins: 1, teachers: 1, students: 1, adventures: 1, published: 1, attempts: 1, attempts_since: 1,
    });
    expect(Number(statsA?.llm_cost_since)).toBeCloseTo(0.00023, 9);
    expect(Number(statsA?.image_cost)).toBeCloseTo(0.01, 6);
    expect(statsB).toMatchObject({
      admins: 1, teachers: 1, students: 1, adventures: 1, published: 1, attempts: 1, attempts_since: 1,
    });
    expect(Number(statsB?.llm_cost_since)).toBeCloseTo(0.00013, 9);
    expect(Number(statsB?.image_cost)).toBeCloseTo(0.02, 6);

    const expectedDaily = [
      { purpose: "brief", calls: 1, tokens: 60, cost: 0.00013, unpriced: 0 },
      { purpose: "generation", calls: 1, tokens: 120, cost: 0.00023, unpriced: 0 },
      { purpose: "play", calls: 1, tokens: 10, cost: 0, unpriced: 1 },
    ];
    for (const expected of expectedDaily) {
      expectDailyDelta(after, before, seededDay, expected.purpose, expected);
    }

    const unauthorized: { client: SupabaseClient } = await createUserClient(uniqueEmail("llm-usage-denied"), PASSWORD);
    const denied = await unauthorized.client.rpc("platform_overview", { p_since: since });
    expect(denied.error?.code).toBe("42501");
  });

  it("prices cached input and dated model names, and leaves unknown models unpriced", async () => {
    const model = `test-model-${crypto.randomUUID()}`;
    await addModelPrice(model, 2, 1, 3);

    const args = { p_input: 100, p_cached: 40, p_output: 20 };
    const [exact, dated, unknown, nullModel] = await Promise.all([
      admin.rpc("llm_call_cost", { p_model: model, ...args }),
      admin.rpc("llm_call_cost", { p_model: `${model}-2026-01-01`, ...args }),
      admin.rpc("llm_call_cost", { p_model: `unknown-${crypto.randomUUID()}`, ...args }),
      admin.rpc("llm_call_cost", { p_model: null, ...args }),
    ]);
    expect(exact.error).toBeNull();
    expect(dated.error).toBeNull();
    expect(unknown.error).toBeNull();
    expect(nullModel.error).toBeNull();
    expect(Number(exact.data)).toBeCloseTo(0.00022, 9);
    expect(Number(dated.data)).toBeCloseTo(0.00022, 9);
    expect(unknown.data).toBeNull();
    expect(nullModel.data).toBeNull();
  });

  it("recalculates historical costs as model prices are added and updated", async () => {
    const since = new Date(Date.now() + 60_000).toISOString();
    const occurredAt = new Date(Date.now() + 120_000).toISOString();
    const day = occurredAt.slice(0, 10);
    const model = `test-model-${crypto.randomUUID()}`;
    const before = await metricsSnapshot(since);
    const schoolA = await createOrganization("LLM Retroactive A");
    const schoolB = await createOrganization("LLM Retroactive B");
    const { error: usageError } = await admin.from("llm_usage").insert([
      {
        organization_id: schoolA,
        purpose: "generation",
        call: "retroactive_pricing",
        model,
        input_tokens: 100,
        cached_input_tokens: 30,
        output_tokens: 20,
        occurred_at: occurredAt,
      },
      {
        organization_id: schoolB,
        purpose: "generation",
        call: "retroactive_pricing",
        model,
        input_tokens: 100,
        cached_input_tokens: 30,
        output_tokens: 20,
        occurred_at: occurredAt,
      },
    ]);
    expect(usageError).toBeNull();

    const unpriced = await metricsSnapshot(since);
    expect(delta(unpriced.overview.unpriced_calls_since, before.overview.unpriced_calls_since)).toBe(2);
    expect(Number(unpriced.overview.llm_cost_since) - Number(before.overview.llm_cost_since)).toBeCloseTo(0, 9);
    expect(Number(unpriced.schools.find((school) => school.organization_id === schoolA)?.llm_cost_since)).toBe(0);
    expect(Number(unpriced.schools.find((school) => school.organization_id === schoolB)?.llm_cost_since)).toBe(0);
    expectDailyDelta(unpriced, before, day, "generation", { calls: 2, tokens: 240, cost: 0, unpriced: 2 });
    const { data: unpricedRows, error: unpricedError } = await admin.rpc("platform_model_prices");
    expect(unpricedError).toBeNull();
    const unpricedModel = (unpricedRows as Record<string, string | number | null>[]).find((row) => row.model === model);
    expect(unpricedModel?.input_usd_per_mtok).toBeNull();
    expect(Number(unpricedModel?.calls)).toBe(2);
    expect(Number(unpricedModel?.tokens)).toBe(240);

    await addModelPrice(model, 2, 1, 3);
    const priced = await metricsSnapshot(since);
    expect(delta(priced.overview.unpriced_calls_since, unpriced.overview.unpriced_calls_since)).toBe(-2);
    expect(Number(priced.overview.llm_cost_since) - Number(unpriced.overview.llm_cost_since)).toBeCloseTo(0.00046, 9);
    expect(Number(priced.schools.find((school) => school.organization_id === schoolA)?.llm_cost_since)).toBeCloseTo(0.00023, 9);
    expect(Number(priced.schools.find((school) => school.organization_id === schoolB)?.llm_cost_since)).toBeCloseTo(0.00023, 9);
    expectDailyDelta(priced, unpriced, day, "generation", { calls: 0, tokens: 0, cost: 0.00046, unpriced: -2 });

    const { error: updateError } = await admin.from("model_price").update({
      input_usd_per_mtok: 4,
      cached_input_usd_per_mtok: 2,
      output_usd_per_mtok: 6,
      updated_at: new Date().toISOString(),
    }).eq("model", model);
    expect(updateError).toBeNull();

    const repriced = await metricsSnapshot(since);
    expect(delta(repriced.overview.unpriced_calls_since, priced.overview.unpriced_calls_since)).toBe(0);
    expect(Number(repriced.overview.llm_cost_since) - Number(priced.overview.llm_cost_since)).toBeCloseTo(0.00046, 9);
    expect(Number(repriced.schools.find((school) => school.organization_id === schoolA)?.llm_cost_since)).toBeCloseTo(0.00046, 9);
    expect(Number(repriced.schools.find((school) => school.organization_id === schoolB)?.llm_cost_since)).toBeCloseTo(0.00046, 9);
    expectDailyDelta(repriced, priced, day, "generation", { calls: 0, tokens: 0, cost: 0.00046, unpriced: 0 });

    const { data: prices, error: pricesError } = await admin.rpc("platform_model_prices");
    expect(pricesError).toBeNull();
    const modelPrice = (prices as Record<string, string | number | null>[]).find((row) => row.model === model);
    expect(Number(modelPrice?.input_usd_per_mtok)).toBe(4);
    expect(Number(modelPrice?.cached_input_usd_per_mtok)).toBe(2);
    expect(Number(modelPrice?.output_usd_per_mtok)).toBe(6);
    expect(Number(modelPrice?.calls)).toBe(2);
    expect(Number(modelPrice?.tokens)).toBe(240);
    expect(new Date(String(modelPrice?.last_used)).toISOString()).toBe(occurredAt);
  });

  it("limits model pricing reads and writes to service-role operations", async () => {
    const unauthorized = await createUserClient(uniqueEmail("llm-prices-denied"), PASSWORD);
    const [prices, cost] = await Promise.all([
      unauthorized.client.rpc("platform_model_prices"),
      unauthorized.client.rpc("llm_call_cost", {
        p_model: "gpt-5.4",
        p_input: 1,
        p_cached: 0,
        p_output: 1,
      }),
    ]);
    expect(prices.error?.code).toBe("42501");
    expect(cost.error?.code).toBe("42501");

    const { data, error: readError } = await unauthorized.client.from("model_price").select("model");
    expect(readError).toBeNull();
    expect(data).toEqual([]);

    const { error: insertError } = await unauthorized.client.from("model_price").insert({
      model: `unauthorized-${crypto.randomUUID()}`,
      input_usd_per_mtok: 1,
      cached_input_usd_per_mtok: 1,
      output_usd_per_mtok: 1,
    });
    expect(insertError?.code).toBe("42501");
  });

  it("returns one zero-filled row per UTC day for daily activity, to the service role only", async () => {
    const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.rpc("platform_activity_daily", { p_since: since });
    expect(error).toBeNull();
    const rows = (data ?? []) as Record<string, string | number>[];
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.at(-1)?.day).toBe(new Date().toISOString().slice(0, 10));
    for (const row of rows) {
      for (const key of ["attempts_started", "attempts_completed", "active_students", "play_seconds", "new_members"]) {
        expect(Number(row[key])).toBeGreaterThanOrEqual(0);
      }
    }

    const unauthorized: { client: SupabaseClient } = await createUserClient(uniqueEmail("llm-activity-denied"), PASSWORD);
    const denied = await unauthorized.client.rpc("platform_activity_daily", { p_since: since });
    expect(denied.error?.code).toBe("42501");
  });
});
