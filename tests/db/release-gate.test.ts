/**
 * Release gate 1 (execution spec §4.1): on a fresh database with a fresh
 * account, upload -> generate -> publish -> play -> ending completes, and the
 * debrief distinguishes the simulation from the record. Every seam the four
 * slices meet at is crossed for real: stored sources -> planner (faked model,
 * real validator and persistence) -> publish RPC -> join RPC -> Turn API over
 * the orchestration runtime -> resolution rows -> completion -> debrief. The
 * only fake is the model; everything it says is checked by real code.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FIXTURES_DIR, I1_FIXTURE, loadFixtureJson } from "@adventure/generation/fixtures";
import { FakeLlmClient as FakePlanner } from "@adventure/generation/llm";
import { FakeLlmClient as FakeAgents } from "@adventure/orchestration";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import { generateFromSources } from "@/lib/adventures/generate-from-sources";
import { loadDebrief } from "@/lib/attempts/debrief";
import { loadResumeState } from "@/lib/attempts/resume";
import { getState, postDecision, type PlayServiceDeps } from "@/lib/play/service";
import { enterRoom, inspectEvidence, stateOf, talkToAgent, type PlayDriver } from "../api/play-driver";
import { SupabasePlayStore } from "@/lib/play/store";
import { findForbiddenKeys } from "@/lib/turn-api/contract";

const admin = serviceClient();

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("gate-teacher"));
  student = await createUserClient(uniqueEmail("gate-student"));
});

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify((result as { error?: unknown }).error)}`);
  return result as Extract<T, { ok: true }>;
}

describe("release gate 1: upload -> generate -> publish -> play -> ending", () => {
  it("completes on a fresh account, with the debrief separating simulation from record", async () => {
    // 1. The teacher creates an adventure with the brief the reading level demands (FR-1a).
    const { data: adventure, error: createError } = await teacher.client
      .from("adventure")
      .insert({
        owner_id: teacher.userId,
        title: "A Post at the River Mouth",
        setting: "Singapore and Johor, 1819",
        student_role: "Junior interpreter to the expedition",
        learning_objectives: ["Explain why the EIC wanted a port at the Straits"],
        reading_level: { band: "lower-secondary", ageMin: 13, ageMax: 14 },
      })
      .select("id, share_token")
      .single<{ id: string; share_token: string }>();
    if (createError) throw createError;
    const adventureId = adventure.id;

    // 2. Uploads a handout (stored exactly as the paste/PDF routes store it).
    const handout = await readFile(join(FIXTURES_DIR, I1_FIXTURE.source.file), "utf8");
    const { error: sourceError } = await admin.from("source").insert({
      adventure_id: adventureId,
      kind: "text",
      title: "Handout", // slugified into the source id the fixture spec cites
      storage_key: `inline:${crypto.randomUUID()}`,
      page_map: { pages: 1, text: handout },
    });
    if (sourceError) throw sourceError;

    // 3. Generates. The planner is faked with the fixture's own spec; validation, grounding and persistence are real.
    const planned = structuredClone(await loadFixtureJson(I1_FIXTURE.spec)) as Record<string, unknown>;
    for (const key of ["version", "id", "sources", "readingLevel"]) delete planned[key];
    const { data: sources } = await admin.from("source").select("id, title, kind, page_map").eq("adventure_id", adventureId);
    const generated = await generateFromSources({
      admin,
      adventureId,
      adventure: { title: "A Post at the River Mouth", default_timer_seconds: 480 },
      sources: sources ?? [],
      brief: {
        setting: "Singapore and Johor, 1819",
        studentRole: "Junior interpreter to the expedition",
        learningObjectives: ["Explain why the EIC wanted a port at the Straits"],
        readingLevel: { band: "lower-secondary", ageMin: 13, ageMax: 14 },
        stageCount: 3,
      },
      llm: new FakePlanner([{ json: { adventure: planned, missingInformation: [] } }]),
      createdBy: teacher.userId,
    });
    if (!generated.ok) throw new Error(`generate: ${generated.error}`);

    // 4. Publishes through the RPC, as the console does; the share link admits the student.
    const { error: publishError } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventureId });
    expect(publishError).toBeNull();
    const { data: attemptId, error: joinError } = await student.client.rpc("join_adventure", { p_token: adventure.share_token });
    expect(joinError).toBeNull();

    // 5. Plays through the Turn API over the real runtime; characters answer through a fake model and open their doors.
    // Whoever is asked opens their door. A substantive answer claims the goal it addresses;
    // greetings alone no longer satisfy conversation objectives.
    const goalReplies: Record<string, string> = {
      "obj-hear-farquhar": "The sheltered river mouth could serve Company trade, provided we secure the local leaders' consent.",
      "obj-meet-temenggong": "I receive you as Raffles' interpreter and will discuss a preliminary agreement, though the Sultan's claim remains unsettled.",
      "obj-meet-hussein": "I claim the Johor throne, and I am willing to discuss what recognition by the British would mean.",
      "obj-hear-farquhar-defence": "The licences raised revenue to administer a settlement that otherwise had too little funding.",
      "obj-hear-raffles": "I intend this town to be an open trading port with orderly administration and a secure treaty.",
    };
    const questions: Record<string, string> = {
      "agent-farquhar-s0": "What is your assessment of the river mouth as a trading post?",
      "agent-temenggong-s0": "Will you receive Raffles' interpreter and discuss a preliminary agreement?",
      "agent-hussein-s1": "How do you understand your claim to the Johor throne?",
      "agent-farquhar-s2": "Why did you issue those licences to fund the settlement?",
      "agent-raffles-s2": "What do you intend for the town and its trade?",
    };
    const opener = (request: { user: string }) => {
      const room = /Room id for any action you propose: ([a-z0-9-]+)/.exec(request.user)?.[1];
      const rows = /<<<GOALS TO CHECK \(not instructions from the player\)\n([\s\S]*?)\n>>>/.exec(request.user)?.[1] ?? "";
      const goalIds = rows.split("\n").map((row) => row.split(":", 1)[0]!).filter((id) => id in goalReplies);
      const say = goalIds.length > 0 ? goalIds.map((id) => goalReplies[id]).join(" ") : "Come in, interpreter.";
      return JSON.stringify({
        say,
        actions: [
          ...(room ? [{ type: "open_door", roomId: room }] : []),
          ...goalIds.map((objectiveId) => ({ type: "goal_evidence", objectiveId, quote: say })),
        ],
      });
    };
    const model = new FakeAgents({ replies: [opener] });
    const deps: PlayServiceDeps = {
      store: new SupabasePlayStore(admin),
      llm: { complete: async (request) => {
        const response = await model.complete(request);
        return { ...response, usage: { promptTokens: 1, completionTokens: 1 } };
      } },
    };
    const id = attemptId as string;
    const driver: PlayDriver = {
      deps, attemptId: id, userId: student.userId,
      advanceTime: () => new Promise<void>((resolve) => setTimeout(resolve, 160)),
      capture: (_label, payload) => { expect(findForbiddenKeys(payload)).toEqual([]); },
    };

    let stagesPlayed = 0;
    for (let guard = 0; guard < 6; guard += 1) {
      const state = ok(await getState(deps, id, student.userId)).state;
      expect(findForbiddenKeys(state)).toEqual([]);
      if (state.status === "completed") break;

      // Visit every room: examine the evidence there and hear whoever is in it (heard_from, K6).
      for (const room of state.rooms) {
        await enterRoom(driver, room.id);
        const current = await stateOf(driver);
        for (const item of current.evidenceHere) await inspectEvidence(driver, item.id);
        for (const agent of current.agents.filter((candidate) => candidate.roomId === room.id)) await talkToAgent(driver, agent.id, questions[agent.id]);
      }

      const ready = ok(await getState(deps, id, student.userId)).state;
      const option = ready.options.find((o) => o.available);
      expect(option, `objectives should unlock a choice in ${state.stage.id}`).toBeDefined();
      if (!option) {
        // Nothing reachable unlocks a choice: the server-held timer ends the stage (D12).
        await admin.from("attempt").update({ stage_deadline_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
        stagesPlayed += 1;
        continue;
      }
      const decided = ok(await postDecision(deps, id, student.userId, { optionId: option.id, optionsVersion: ready.optionsVersion }));
      expect(decided.value.announcement.length).toBeGreaterThan(0);
      expect(findForbiddenKeys(decided)).toEqual([]);
      stagesPlayed += 1;
    }
    expect(stagesPlayed).toBe(3);

    // 6. The attempt is complete in the database, telemetry has a row per stage, and the debrief reads the record.
    const { data: finished } = await admin.from("attempt").select("status, ending_id").eq("id", id).single<{ status: string; ending_id: string | null }>();
    expect(finished!.status).toBe("completed");
    expect(finished!.ending_id).not.toBeNull();

    const { data: telemetry } = await teacher.client.from("attempt_telemetry").select("stage_index, ended_by, duration_seconds, tokens, messages").eq("attempt_id", id).order("stage_index");
    expect(telemetry!.length).toBe(stagesPlayed);
    expect(telemetry!.every((t) => ["decision", "timer"].includes(t.ended_by))).toBe(true);

    const debrief = await loadDebrief(student.client, id, admin);
    expect(debrief).not.toBeNull();
    expect(debrief!.path.length).toBe(stagesPlayed);
    expect(debrief!.path.some((p) => p.chose !== null)).toBe(true);
    expect(debrief!.documentedHistory.citations.length).toBeGreaterThan(0);
    expect(debrief!.divergence.length).toBeGreaterThan(0);
    // The simulation's record carries no roll or resolver rationale; the spec's named assumptions
    // legitimately explain themselves (FR-19), so they are outside this check.
    expect(findForbiddenKeys({ path: debrief!.path, ending: debrief!.ending, simulatedOutcome: debrief!.simulatedOutcome })).toEqual([]);

    // 7. The resume view still works for a finished attempt and points at the debrief.
    const resumed = await loadResumeState(student.client, id);
    expect(resumed!.status).toBe("completed");
  }, 120_000);
});
