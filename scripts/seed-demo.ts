/**
 * Seed a playable demo adventure so a grader can play without a teacher
 * account: publishes the I1 fixture (Singapore, 1819) under the demo teacher
 * provisioned by the `demo_teacher` migration and prints the share link.
 * Idempotent — re-running reuses the demo teacher and adds a new adventure.
 * The teacher account itself is NOT created here; it comes from migrations so
 * it exists in every environment (`npx supabase db reset` / `db push`).
 *
 *   npm run db:seed                      # local stack (reads `supabase status`)
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… APP_URL=https://… npm run db:seed   # hosted
 *
 * Runs through vitest only so it can import the workspace TypeScript directly.
 */
import { loadFixtureJson, I1_FIXTURE } from "@adventure/generation/fixtures";
import { it } from "vitest";

import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { serviceClient } from "../tests/db/helpers";

const DEMO_EMAIL = process.env.DEMO_TEACHER_EMAIL ?? "demo-teacher@adventure.local";

it("seeds the demo adventure", async () => {
  const admin = serviceClient();
  const existing = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === DEMO_EMAIL);
  if (!existing) {
    throw new Error(
      `Demo teacher ${DEMO_EMAIL} not found. The account is provisioned by the demo_teacher migration — apply migrations first (npx supabase db reset locally, or supabase db push on the target project), then re-run this seed.`,
    );
  }
  const userId = existing.id;

  const spec = (await loadFixtureJson(I1_FIXTURE.spec)) as { title: string; setting: string; studentRole?: string; player?: { role?: string }; readingLevel?: unknown; learningObjectives?: string[] };
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({
      owner_id: userId,
      title: `${spec.title} (demo)`,
      setting: spec.setting,
      student_role: spec.player?.role ?? spec.studentRole ?? null,
      learning_objectives: spec.learningObjectives ?? [],
      reading_level: spec.readingLevel ?? null,
    })
    .select("id, share_token")
    .single<{ id: string; share_token: string }>();
  if (error) throw error;

  await persistSpecVersion(admin, adventure.id, spec, { generatorVersion: "seed-demo", createdBy: userId });
  const { error: publishError } = await admin.rpc("publish_adventure", { p_adventure_id: adventure.id });
  if (publishError) {
    // publish_adventure checks ownership through auth.uid(); the service role has none, so publish directly.
    const { data: version } = await admin.from("spec_version").select("id").eq("adventure_id", adventure.id).eq("version", 1).single<{ id: string }>();
    await admin.from("spec_version").update({ published_at: new Date().toISOString() }).eq("id", version!.id);
    await admin.from("adventure").update({ status: "published", published_version: 1 }).eq("id", adventure.id);
  }

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`\nDemo adventure published.\n  adventure: ${adventure.id}\n  teacher:   ${DEMO_EMAIL}\n  join link: ${appUrl}/join/${adventure.share_token}\n`);
});
