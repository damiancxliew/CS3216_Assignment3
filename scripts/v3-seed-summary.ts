import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { EngineSpec } from "@adventure/engine";
import type { GameEvent } from "@adventure/play-contract";
import { it } from "vitest";

import { serviceClient, SUPABASE_URL, TESTING_SCHOOL_ID } from "../tests/db/helpers";

const ADVENTURE_ID = "00000000-0000-4000-8000-000000005c02";
const STUDENT_EMAILS = Array.from(
  { length: 5 },
  (_, index) => `v3-summary-student-${index + 1}@local.test`,
);

function assertLocalSupabaseUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("The v3 summary seed only runs against a localhost Supabase URL.");
  }
}

function sampleEvents(spec: ReturnType<typeof EngineSpec.parse>, index: number): GameEvent[] {
  const discovery = spec.discoveries[0]!;
  const moment = spec.definingMoments[0]!;
  const ending = spec.endings[0]!;
  const noteId = `summary-note-${index}`;
  const initialVerdict = ending.interview.verdicts[0]!;
  const alternateVerdict =
    ending.interview.verdicts.find((verdict) => verdict.id !== initialVerdict.id) ?? initialVerdict;
  const outcome = moment.outcomes[0]!;
  const events: GameEvent[] = [];

  if (index < 3) {
    events.push({
      type: "hint",
      at: index * 10 + 1,
      stageIndex: 0,
      level: index === 2 ? 2 : 1,
      targetDiscoveryId: discovery.id,
    });
  }
  if (index < 4) {
    events.push({
      type: "prediction",
      at: index * 10 + 2,
      stageIndex: 0,
      momentId: moment.id,
      outcomeId: moment.outcomes[index % moment.outcomes.length]!.id,
    });
  }
  if (index !== 2) {
    events.push({
      type: "discovery",
      at: index * 10 + 3,
      stageIndex: 0,
      discoveryId: discovery.id,
      noteId,
      core: discovery.core,
      via: "conversation",
    });
  }
  if (index === 0 || index === 1 || index === 4) {
    events.push({
      type: "verdict",
      at: index * 10 + 4,
      stageIndex: 0,
      endingId: ending.id,
      verdictId: initialVerdict.id,
      evidenceNoteIds: index === 2 ? [] : [noteId],
      stage: "initial",
      text: index === 0 ? "The Company acted for its own advantage." : "A treaty could bring stability.",
    });
  }
  if (index === 0) {
    events.push({
      type: "verdict",
      at: index * 10 + 5,
      stageIndex: 0,
      endingId: ending.id,
      verdictId: alternateVerdict.id,
      evidenceNoteIds: [noteId],
      stage: "final",
      text: "The evidence points to a more complicated bargain.",
    });
  }
  if (index === 0 || index === 1 || index === 3) {
    events.push({
      type: "outcome",
      at: index * 10 + 6,
      stageIndex: 0,
      momentId: moment.id,
      outcomeId: outcome.id,
      endingId: ending.id,
      closedEndingIds: [],
    });
  }
  if (index === 0 || index === 3) {
    events.push({ type: "phase", at: index * 10 + 7, stageIndex: 0, to: "reveal" });
  }
  if (index === 4) {
    events.push({
      type: "flag",
      at: index * 10 + 8,
      stageIndex: 0,
      messageId: "summary-flagged-message",
      category: "provocative",
      reason: "A teacher should follow up.",
    });
  }
  return events;
}

async function seedSummaryAttempts() {
  const configuredUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL;
  assertLocalSupabaseUrl(configuredUrl);
  const admin = serviceClient();
  const { data: version, error: versionError } = await admin
    .from("adventure_versions_v3")
    .select("version")
    .eq("adventure_id", ADVENTURE_ID)
    .eq("version", 1)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) throw new Error("Run the v3 golden seed before seeding class summary attempts.");

  const { data: users, error: usersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (usersError) throw usersError;
  const usersByEmail = new Map(users.users.map((user) => [user.email, user]));

  const studentIds: string[] = [];
  for (const email of STUDENT_EMAILS) {
    const existing = usersByEmail.get(email);
    const result = existing
      ? { data: { user: existing }, error: null }
      : await admin.auth.admin.createUser({
          email,
          password: "password123!",
          email_confirm: true,
        });
    if (result.error || !result.data.user) {
      throw result.error ?? new Error(`Could not create local summary student ${email}.`);
    }
    const studentId = result.data.user.id;
    studentIds.push(studentId);
    const { error: membershipError } = await admin.from("organization_member").upsert(
      {
        organization_id: TESTING_SCHOOL_ID,
        user_id: studentId,
        role: "student",
        status: "active",
        added_by: null,
        removed_by: null,
        removed_at: null,
      },
      { onConflict: "organization_id,user_id" },
    );
    if (membershipError) throw membershipError;
  }

  const { data: existingAttempts, error: attemptsError } = await admin
    .from("attempts_v3")
    .select("student_id")
    .eq("adventure_id", ADVENTURE_ID)
    .eq("spec_version", 1)
    .in("student_id", studentIds);
  if (attemptsError) throw attemptsError;
  const alreadySeeded = new Set((existingAttempts ?? []).map((attempt) => attempt.student_id));
  const spec = EngineSpec.parse(
    JSON.parse(await readFile(resolve(process.cwd(), "fixtures/golden-1819.json"), "utf8")) as unknown,
  );

  let seeded = 0;
  for (const [index, studentId] of studentIds.entries()) {
    if (alreadySeeded.has(studentId)) continue;
    const { data: attempt, error: attemptError } = await admin
      .from("attempts_v3")
      .insert({
        adventure_id: ADVENTURE_ID,
        spec_version: 1,
        student_id: studentId,
        state: { phase: index < 2 ? "reveal" : "stage" },
      })
      .select("id")
      .single();
    if (attemptError) throw attemptError;

    const events = sampleEvents(spec, index);
    const { error: eventError } = await admin.from("attempt_events_v3").insert(
      events.map(({ type, ...payload }, eventIndex) => ({
        attempt_id: attempt.id,
        seq: eventIndex + 1,
        type,
        payload,
      })),
    );
    if (eventError) throw eventError;
    seeded += 1;
  }

  console.log(
    `Seeded ${seeded} class-summary attempts on ${ADVENTURE_ID} version 1; flagged student: ${STUDENT_EMAILS[4]}.`,
  );
}

if (process.env.VITEST) {
  it("seeds class summary attempts locally", seedSummaryAttempts, 120_000);
} else {
  void seedSummaryAttempts();
}
