import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EngineSpec } from "@adventure/engine";
import { it } from "vitest";

import { serviceClient, SUPABASE_URL, TESTING_SCHOOL_ID } from "../tests/db/helpers";

const STUDENT_EMAIL = "v3-student@local.test";
const STUDENT_PASSWORD = "password123!";
const SCHOOL_NAME = "Testing School";
const SCHOOL_SLUG = "testing-school";
const ADVENTURE_ID = "00000000-0000-4000-8000-000000005c02";

function assertLocalSupabaseUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("The v3 golden seed only runs against a localhost Supabase URL.");
  }
}

async function seedGoldenAdventure() {
  const configuredUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL;
  assertLocalSupabaseUrl(configuredUrl);
  const admin = serviceClient();
  const { error: schoolError } = await admin.from("organization").upsert({
    id: TESTING_SCHOOL_ID,
    name: SCHOOL_NAME,
    slug: SCHOOL_SLUG,
  }, { onConflict: "id" });
  if (schoolError) throw schoolError;

  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = users.users.find((user) => user.email === STUDENT_EMAIL);
  const userResult = existing
    ? await admin.auth.admin.updateUserById(existing.id, {
        password: STUDENT_PASSWORD,
        email_confirm: true,
      })
    : await admin.auth.admin.createUser({
        email: STUDENT_EMAIL,
        password: STUDENT_PASSWORD,
        email_confirm: true,
      });
  if (userResult.error || !userResult.data.user) throw userResult.error ?? new Error("Could not create the local student.");
  const studentId = userResult.data.user.id;

  const { error: membershipError } = await admin.from("organization_member").upsert({
    organization_id: TESTING_SCHOOL_ID,
    user_id: studentId,
    role: "student",
    status: "active",
    added_by: null,
    removed_by: null,
    removed_at: null,
  }, { onConflict: "organization_id,user_id" });
  if (membershipError) throw membershipError;

  const fixture = JSON.parse(await readFile(resolve(process.cwd(), "fixtures/golden-1819.json"), "utf8")) as unknown;
  const spec = EngineSpec.parse(fixture);
  const { error: adventureError } = await admin.from("adventures_v3").upsert({
    id: ADVENTURE_ID,
    school_id: TESTING_SCHOOL_ID,
    owner_id: studentId,
    status: "published",
    spec,
  }, { onConflict: "id" });
  if (adventureError) throw adventureError;

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log([
    "Local v3 golden adventure seeded.",
    `school_id=${TESTING_SCHOOL_ID}`,
    `student_id=${studentId}`,
    `adventure_id=${ADVENTURE_ID}`,
    `student_email=${STUDENT_EMAIL}`,
    `student_password=${STUDENT_PASSWORD}`,
    `start_url=${appUrl}/v3/play/start/${ADVENTURE_ID}`,
  ].join("\n"));
}

if (process.env.VITEST) {
  it("seeds the golden v3 adventure locally", seedGoldenAdventure, 120_000);
} else {
  void seedGoldenAdventure();
}
