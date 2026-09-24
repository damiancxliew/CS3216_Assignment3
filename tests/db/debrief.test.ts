/**
 * P8 — ending and debrief (FR-19). Validation: documented history and
 * simulated assumption are visually distinct. The visual part is the page's
 * job; what is testable — and what the page's separation rests on — is that
 * the two arrive as separate fields, that every cited span resolves to a real
 * source with a page and a verbatim quote, and that the debrief is read from
 * the version the attempt pinned rather than whatever the teacher published
 * since (P4).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { loadDebrief } from "@/lib/attempts/debrief";

import { createUserClient, prepareVersionMaps, serviceClient, uniqueEmail } from "./helpers";

const admin = serviceClient();

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("p8-teacher"));
  student = await createUserClient(uniqueEmail("p8-student"));
});

function specJson(endingSummary: string) {
  return {
    title: "The Treaty",
    stages: [{ index: 0, title: "The table", evidence: [{ id: "treaty-note", name: "Treaty terms" }, { id: "unread-note", name: "Unread terms" }] }],
    sources: [
      {
        id: "dispatch",
        title: "Dispatch of 14 March 1819",
        kind: "primary",
        pageCount: 12,
      },
    ],
    assumptions: [
      {
        id: "weather",
        text: "The envoy's delay was caused by weather.",
        rationale: "No source records why he was late; a storm is plausible.",
      },
    ],
    endings: [
      {
        id: "treaty-signed",
        title: "The treaty is signed",
        summary: endingSummary,
        historicalOutcome: {
          text: "The treaty was signed on 6 February 1819.",
          spans: [
            { sourceId: "dispatch", page: 4, quote: "signed this sixth day" },
            { sourceId: "missing-source", page: 2, quote: "an unresolvable span" },
          ],
          assumptionIds: ["weather", "not-an-assumption"],
        },
        divergence: "You reached the table three days later than the delegation did.",
        reflectionQuestions: [
          "Whose account of the delay would you trust, and why?",
          "What would you need to see to call the weather explanation more than a guess?",
        ],
      },
    ],
  };
}

async function seedCompletedAttempt() {
  const { data: adventure } = await admin
    .from("adventure")
    .insert({ owner_id: teacher.userId, title: "The Treaty" })
    .select("id, share_token")
    .single();

  const { data: version } = await admin
    .from("spec_version")
    .insert({
      adventure_id: adventure!.id,
      version: 1,
      json: specJson("You signed, over the objections of the merchants."),
      generator_version: "test",
    })
    .select("id")
    .single();

  const { data: stage } = await admin
    .from("stage")
    .insert({ spec_version_id: version!.id, index: 0, title: "The table" }).select("id").single();

  await prepareVersionMaps(admin, version!.id);
  await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure!.id });

  const { data: attemptId } = await student.client.rpc("join_adventure", {
    p_token: adventure!.share_token,
  });
  await admin.rpc("complete_attempt", {
    p_attempt_id: attemptId,
    p_ending_id: "treaty-signed",
  });

  return { adventureId: adventure!.id as string, attemptId: attemptId as string, stageId: stage!.id as string };
}

describe("debrief", () => {
  it("shows a conversation-generated choice and collected evidence without treating the choice as a timeout", async () => {
    const { attemptId, stageId } = await seedCompletedAttempt();
    const { data: minted, error: mintError } = await admin.from("minted_option").insert({ attempt_id: attemptId, stage_id: stageId, spec_id: "negotiated-choice", label: "Ask for a revised agreement" }).select("id").single();
    expect(mintError).toBeNull();
    const { error: commitmentError } = await admin.from("stage_commitment").insert({ attempt_id: attemptId, stage_id: stageId, actor_kind: "player", player_id: student.userId, minted_option_id: minted!.id });
    expect(commitmentError).toBeNull();
    const { error: resolutionError } = await admin.from("resolution").insert({ attempt_id: attemptId, stage_id: stageId, outcome: { announcement: "Negotiations continued.", worldDeltas: [] } });
    expect(resolutionError).toBeNull();
    const { error: journalError } = await admin.from("attempt_state").update({ journal: [
      { id: "treaty-note", text: "Treaty terms: The annual payment was disputed.\n\nWhose interests would a revision protect?", sourceSpan: "Dispatch, p. 4: signed this sixth day" },
      { id: "archived-note", text: "Earlier evidence: A previous discovery.", sourceSpan: null },
    ] }).eq("attempt_id", attemptId);
    expect(journalError).toBeNull();

    const debrief = await loadDebrief(student.client, attemptId, admin);
    expect(debrief!.path[0]).toMatchObject({ chose: "Ask for a revised agreement", evidenceFound: 1 });
    expect(debrief!.collectedEvidence).toEqual([
      { id: "treaty-note", name: "Treaty terms", text: "The annual payment was disputed.\n\nWhose interests would a revision protect?", sourceSpan: "Dispatch, p. 4: signed this sixth day", stageTitle: "The table" },
      { id: "archived-note", name: "Earlier evidence", text: "A previous discovery.", sourceSpan: null, stageTitle: null },
    ]);
  });

  it("keeps documented history, its citations and the simulation's own inventions apart", async () => {
    const { attemptId } = await seedCompletedAttempt();

    const debrief = await loadDebrief(student.client, attemptId, admin);

    expect(debrief!.simulatedOutcome).toBe(
      "You signed, over the objections of the merchants.",
    );
    expect(debrief!.documentedHistory.text).toBe(
      "The treaty was signed on 6 February 1819.",
    );
    expect(debrief!.documentedHistory.citations[0]).toEqual({
      sourceId: "dispatch",
      sourceTitle: "Dispatch of 14 March 1819",
      sourceKind: "primary",
      page: 4,
      quote: "signed this sixth day",
    });
    expect(debrief!.assumptions).toEqual([
      {
        id: "weather",
        text: "The envoy's delay was caused by weather.",
        rationale: "No source records why he was late; a storm is plausible.",
      },
    ]);
    expect(debrief!.divergence).toContain("three days later");
    expect(debrief!.reflectionQuestions).toHaveLength(2);
  });

  it("never drops a citation it cannot resolve, and never invents an assumption", async () => {
    const { attemptId } = await seedCompletedAttempt();

    const debrief = await loadDebrief(student.client, attemptId, admin);

    // An unresolvable source still shows its page and quote, under its own id,
    // rather than silently disappearing from the evidence a student can check.
    const unresolved = debrief!.documentedHistory.citations[1];
    expect(unresolved.sourceTitle).toBe("missing-source");
    expect(unresolved.quote).toBe("an unresolvable span");
    // A dangling assumption id is the opposite case: nothing to show, so nothing
    // is shown — an empty claim must not be dressed as a stated assumption.
    expect(debrief!.assumptions.map((a) => a.id)).toEqual(["weather"]);
  });

  it("debriefs on the version the attempt pinned, not the one published since", async () => {
    const { adventureId, attemptId } = await seedCompletedAttempt();

    await teacher.client.rpc("create_draft_version", {
      p_adventure_id: adventureId,
    });
    await admin
      .from("spec_version")
      .update({ json: specJson("A rewritten ending the student never played.") })
      .eq("adventure_id", adventureId)
      .eq("version", 2);
    const { data: draft } = await admin.from("spec_version").select("id").eq("adventure_id", adventureId).eq("version", 2).single();
    await prepareVersionMaps(admin, draft!.id);
    await teacher.client.rpc("publish_adventure", { p_adventure_id: adventureId });

    const debrief = await loadDebrief(student.client, attemptId, admin);
    expect(debrief!.simulatedOutcome).toBe(
      "You signed, over the objections of the merchants.",
    );
  });

  it("is nothing for another student, and nothing before the attempt ends", async () => {
    const { attemptId } = await seedCompletedAttempt();
    const intruder = await createUserClient(uniqueEmail("p8-intruder"));
    expect(await loadDebrief(intruder.client, attemptId, admin)).toBeNull();

    await admin
      .from("attempt")
      .update({ status: "active", ending_id: null })
      .eq("id", attemptId);
    expect(await loadDebrief(student.client, attemptId, admin)).toBeNull();
  });

  it("is not something a student can award themselves", async () => {
    const { attemptId } = await seedCompletedAttempt();

    const { error } = await student.client.rpc("complete_attempt", {
      p_attempt_id: attemptId,
      p_ending_id: "treaty-signed",
    });
    expect(error).not.toBeNull();
  });
});
