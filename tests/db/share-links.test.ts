/**
 * P3 — sharing links. A link admits a signed-in student to a *published*
 * adventure and to nothing else: a draft is not reachable through its token, a
 * rotated token stops working, and an anonymous caller cannot join at all.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  createUserClient,
  serviceClient,
  uniqueEmail,
} from "./helpers";

const admin = serviceClient();

type SeededAdventure = { id: string; token: string; stageId: string };

async function seedAdventure(
  teacherId: string,
  { published }: { published: boolean },
): Promise<SeededAdventure> {
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({
      owner_id: teacherId,
      title: published ? "The strait" : "Work in progress",
      setting: "1947",
      status: published ? "published" : "draft",
      published_version: published ? 1 : null,
      default_timer_seconds: 600,
    })
    .select("id, share_token")
    .single();
  if (error) throw error;

  const { data: specVersion, error: specError } = await admin
    .from("spec_version")
    .insert({
      adventure_id: adventure.id,
      version: 1,
      json: { stages: [] },
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
    })
    .select("id")
    .single();
  if (stageError) throw stageError;

  // Publishing last: a published version is frozen, so its stages have to
  // exist before the stamp goes on (P4).
  if (published) {
    const { error: publishError } = await admin
      .from("spec_version")
      .update({ published_at: new Date().toISOString() })
      .eq("id", specVersion.id);
    if (publishError) throw publishError;
  }

  return { id: adventure.id, token: adventure.share_token, stageId: stage.id };
}

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let teacher: SupabaseClient;
let otherTeacher: SupabaseClient;
let student: SupabaseClient;
let studentId: string;
let published: SeededAdventure;
let draft: SeededAdventure;

beforeAll(async () => {
  const t = await createUserClient(uniqueEmail("p3-teacher"));
  const o = await createUserClient(uniqueEmail("p3-other-teacher"));
  const s = await createUserClient(uniqueEmail("p3-student"));
  teacher = t.client;
  otherTeacher = o.client;
  student = s.client;
  studentId = s.userId;

  published = await seedAdventure(t.userId, { published: true });
  draft = await seedAdventure(t.userId, { published: false });
});

describe("share_link_preview", () => {
  it("resolves a published adventure, for a visitor who has not signed in yet", async () => {
    const { data, error } = await anonClient()
      .rpc("share_link_preview", { p_token: published.token })
      .maybeSingle<{ adventure_id: string; title: string }>();

    expect(error).toBeNull();
    expect(data?.adventure_id).toBe(published.id);
    expect(data?.title).toBe("The strait");
  });

  it("does not resolve an unpublished adventure", async () => {
    const { data, error } = await anonClient()
      .rpc("share_link_preview", { p_token: draft.token })
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("join_adventure", () => {
  it("refuses an unpublished adventure and leaves no attempt behind", async () => {
    const { error } = await student.rpc("join_adventure", {
      p_token: draft.token,
    });
    expect(error).not.toBeNull();

    const { data } = await admin
      .from("attempt")
      .select("id")
      .eq("adventure_id", draft.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses a token that belongs to nothing", async () => {
    const { error } = await student.rpc("join_adventure", {
      p_token: "00000000-0000-4000-8000-0000000000ff",
    });
    expect(error).not.toBeNull();
  });

  it("refuses an anonymous caller", async () => {
    const { error } = await anonClient().rpc("join_adventure", {
      p_token: published.token,
    });
    expect(error).not.toBeNull();
  });

  it("admits a student, pinning the attempt to the published version with a server-held deadline", async () => {
    const { data: attemptId, error } = await student.rpc("join_adventure", {
      p_token: published.token,
    });
    expect(error).toBeNull();
    expect(attemptId).toBeTruthy();

    const { data: attempt } = await admin
      .from("attempt")
      .select("adventure_id, published_version, student_id, current_stage_id, stage_deadline_at")
      .eq("id", attemptId)
      .single();

    expect(attempt).toMatchObject({
      adventure_id: published.id,
      published_version: 1,
      student_id: studentId,
      current_stage_id: published.stageId,
    });

    // 600s adventure default, no stage override (D12/FR-16).
    const remaining =
      (new Date(attempt!.stage_deadline_at as string).getTime() - Date.now()) / 1000;
    expect(remaining).toBeGreaterThan(540);
    expect(remaining).toBeLessThanOrEqual(600);
  });

  it("resumes rather than restarting when the same link is opened again", async () => {
    const first = await student.rpc("join_adventure", { p_token: published.token });
    const second = await student.rpc("join_adventure", { p_token: published.token });

    expect(first.data).toBe(second.data);

    const { data } = await admin
      .from("attempt")
      .select("id")
      .eq("adventure_id", published.id)
      .eq("student_id", studentId);
    expect(data ?? []).toHaveLength(1);
  });

  it("is what makes the adventure readable: admission comes before access", async () => {
    const { data } = await student
      .from("adventure")
      .select("id")
      .eq("id", published.id);
    expect(data ?? []).toHaveLength(1);

    const { data: unreachable } = await student
      .from("adventure")
      .select("id")
      .eq("id", draft.id);
    expect(unreachable ?? []).toHaveLength(0);
  });
});

describe("rotate_share_token", () => {
  it("cannot be called by anyone but the owner", async () => {
    const { error } = await otherTeacher.rpc("rotate_share_token", {
      p_adventure_id: published.id,
    });
    expect(error).not.toBeNull();
  });

  it("invalidates the old link", async () => {
    const fresh = await seedAdventure(
      (await admin.from("adventure").select("owner_id").eq("id", published.id).single())
        .data!.owner_id,
      { published: true },
    );

    const { data: newToken, error } = await teacher.rpc("rotate_share_token", {
      p_adventure_id: fresh.id,
    });
    expect(error).toBeNull();
    expect(newToken).not.toBe(fresh.token);

    const stale = await anonClient()
      .rpc("share_link_preview", { p_token: fresh.token })
      .maybeSingle();
    expect(stale.data).toBeNull();

    const current = await anonClient()
      .rpc("share_link_preview", { p_token: newToken })
      .maybeSingle<{ adventure_id: string }>();
    expect(current.data?.adventure_id).toBe(fresh.id);
  });
});
