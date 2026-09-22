/**
 * I3 — the Turn API over the real orchestration runtime (K1–K9), driven through
 * the play service with an in-memory store and a fake model, so this runs in
 * the no-database CI job. What it proves: a student can talk, move, knock,
 * examine evidence, decide and reach an ending from the I1 fixture; options
 * are re-derived from state (FR-14); the timer is server-held (D12/FR-16);
 * agents decide by the same rules and their choice is never revealed (D18);
 * every payload is free of private keys (FR-21); and what happened is handed
 * to the store for the record.
 */
import { loadI1Spec } from "@adventure/generation/fixtures";
import { FakeLlmClient } from "@adventure/orchestration";
import type { AdventureSpec } from "@adventure/generation/spec";
import { beforeAll, describe, expect, it } from "vitest";

import { getState, postAction, postDecision, postMessage, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";
import { findForbiddenKeys, publicAttemptStateSchema } from "@/lib/turn-api/contract";

const ATTEMPT = "attempt-under-test";
const STUDENT = "student-1";
const OTHER = "student-2";

const say = (line: string) => JSON.stringify({ say: line, actions: [] });
const opener = (roomId: string) => JSON.stringify({ say: "Come in.", actions: [{ type: "open_door", roomId }] });
/** Whoever is asked opens the door of the room they are in; the prompt names it. */
const openOwnDoor = (request: { user: string }) => {
  const room = /Room id for any action you propose: ([a-z0-9-]+)/.exec(request.user)?.[1];
  return JSON.stringify({ say: "Come in, then.", actions: room ? [{ type: "open_door", roomId: room }] : [] });
};

let spec: AdventureSpec;

function record(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    attemptId: ATTEMPT,
    studentId: STUDENT,
    adventureId: "adv-1",
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec,
    snapshot: null,
    ...overrides,
  };
}

function deps(replies: (string | ((request: { user: string }) => string))[] = Array(60).fill(say("The river mouth is ours to give or keep.")), overrides?: Partial<AttemptRecord>) {
  const store = new MemoryPlayStore([record(overrides)]);
  const llm = new FakeLlmClient({ replies });
  const d: PlayServiceDeps = { store, llm };
  return { d, store };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify((result as { error?: unknown }).error)}`);
  return result as Extract<T, { ok: true }>;
}

beforeAll(async () => {
  spec = await loadI1Spec();
});

describe("GET state", () => {
  it("returns a state matching the public projection schema, plus the map the client draws", async () => {
    const { d } = deps();
    const result = ok(await getState(d, ATTEMPT, STUDENT));
    expect(publicAttemptStateSchema.parse(result.state)).toBeTruthy();
    expect(result.state.stage.index).toBe(0);
    expect(result.state.currentRoomId).toBe(spec.stages[0]!.spawnRoomId);
    expect(result.state.map?.rooms.map((r) => r.id).sort()).toEqual(spec.stages[0]!.rooms.map((r) => r.id).sort());
    expect(result.state.map && "seed" in result.state.map).toBe(false);
    expect(findForbiddenKeys(result.state)).toEqual([]);
  });

  it("is nothing at all for another student", async () => {
    const { d } = deps();
    const result = await getState(d, ATTEMPT, OTHER);
    expect(result).toEqual({ ok: false, error: { code: "not_found", message: "No such attempt." } });
  });

  it("holds the deadline server-side and resolves an expired stage before answering", async () => {
    const { d, store } = deps(undefined, { stageDeadlineAt: "2026-09-22T11:00:00.000Z" }); // store clock is 12:00
    const result = ok(await getState(d, ATTEMPT, STUDENT));
    expect(result.state.stage.index).toBeGreaterThan(0); // the fallback branch opened the next stage
    expect(result.state.announcements).toHaveLength(1);
    const saved = store.saved.at(-1)!;
    expect(saved.events.resolution?.stageIndex).toBe(0);
    expect(saved.events.decisions.map((d) => [d.decision.actorId, d.decision.how])).toContainEqual(["player", "timed_out"]);
  });
});

describe("POST message", () => {
  it("appends the player's line and an in-room reply from whoever is there", async () => {
    const { d, store } = deps();
    const state = ok(await getState(d, ATTEMPT, STUDENT)).state;
    const result = ok(await postMessage(d, ATTEMPT, STUDENT, { roomId: state.currentRoomId!, body: "What do you make of the island?" }));
    expect(result.value.map((m) => m.authorType)).toEqual(["player", "agent"]);
    expect(result.value[1]!.body).toBe("The river mouth is ours to give or keep.");
    expect(result.state.transcript).toHaveLength(2);
    expect(findForbiddenKeys(result)).toEqual([]);
    expect(store.saved.at(-1)!.events.utterances).toHaveLength(2);
  });

  it("rejects a room that is not part of the stage, and one the player is not in", async () => {
    const { d } = deps();
    expect(await postMessage(d, ATTEMPT, STUDENT, { roomId: "nowhere", body: "hello" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    const elsewhere = spec.stages[0]!.rooms.find((r) => r.id !== spec.stages[0]!.spawnRoomId)!;
    expect(await postMessage(d, ATTEMPT, STUDENT, { roomId: elsewhere.id, body: "hello" })).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("POST action", () => {
  it("moves between rooms through open doors, and is refused by a closed one until someone opens it", async () => {
    const { d } = deps();
    const stage = spec.stages[0]!;
    const closed = stage.rooms.find((r) => r.doorDefault === "closed")!;
    const refused = ok(await postAction(d, ATTEMPT, STUDENT, { type: "move_room", toRoomId: closed.id }));
    expect(refused.value.refused).toMatch(/closed/);
    expect(refused.state.currentRoomId).toBe(stage.spawnRoomId);

    // Knocking gives the character inside a beat to answer the door (K4/#8).
    const { d: knocker } = deps(Array(8).fill(opener(closed.id)), { snapshot: refused.state ? undefined : null });
    const knocked = ok(await postAction(knocker, ATTEMPT, STUDENT, { type: "knock", roomId: closed.id }));
    expect(knocked.state.rooms.find((r) => r.id === closed.id)?.doorOpen).toBe(true);
    const moved = ok(await postAction(knocker, ATTEMPT, STUDENT, { type: "move_room", toRoomId: closed.id, position: { x: 3, y: 3 } }));
    expect(moved.value.refused).toBeNull();
    expect(moved.state.currentRoomId).toBe(closed.id);
    expect(moved.state.playerPos).toEqual({ x: 3, y: 3 });
  });

  it("makes an option available once its evidence is examined (FR-14), and records the find in the journal", async () => {
    const { d } = deps();
    const stage = spec.stages[0]!;
    const before = ok(await getState(d, ATTEMPT, STUDENT)).state;
    expect(before.options.every((o) => !o.available)).toBe(true);
    expect(before.options[0]!.unavailableReason).not.toMatch(/precondition|evidence/i);

    const item = stage.evidence.find((e) => e.roomId === stage.spawnRoomId)!;
    const shown = ok(await getState(d, ATTEMPT, STUDENT)).state.evidenceHere;
    expect(shown.map((e) => e.id)).toContain(item.id);
    const inspected = ok(await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: item.id }));
    expect(inspected.state.journal.map((j) => j.id)).toContain(item.id);
    expect(inspected.state.journal[0]!.sourceSpan).toMatch(/p\. \d+/);
    expect(inspected.state.evidenceHere.map((e) => e.id)).not.toContain(item.id);
    const objective = stage.objectives.find((o) => o.targetId === item.id);
    if (objective) expect(inspected.state.stage.objectives.find((o) => o.id === objective.id)?.met).toBe(true);
  });

  it("refuses to examine evidence from another room", async () => {
    const { d } = deps();
    const stage = spec.stages[0]!;
    const elsewhere = stage.evidence.find((e) => e.roomId !== stage.spawnRoomId)!;
    const result = ok(await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: elsewhere.id }));
    expect(result.value.refused).toMatch(/same room/);
    expect(result.state.journal).toHaveLength(0);
  });
});

describe("POST decision", () => {
  async function unlockEverything(d: PlayServiceDeps) {
    // Visit every room: examine its evidence and hear whoever is there (knows_evidence + heard_from, K6).
    const rooms = ok(await getState(d, ATTEMPT, STUDENT)).state.rooms;
    for (const room of rooms) {
      let state = ok(await getState(d, ATTEMPT, STUDENT)).state;
      if (state.currentRoomId !== room.id) {
        let moved = ok(await postAction(d, ATTEMPT, STUDENT, { type: "move_room", toRoomId: room.id }));
        if (moved.value.refused) {
          await postAction(d, ATTEMPT, STUDENT, { type: "knock", roomId: room.id });
          moved = ok(await postAction(d, ATTEMPT, STUDENT, { type: "move_room", toRoomId: room.id }));
        }
        expect(moved.value.refused).toBeNull();
      }
      state = ok(await getState(d, ATTEMPT, STUDENT)).state;
      for (const item of state.evidenceHere) await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: item.id });
      if (state.agents.some((a) => a.roomId === room.id)) await postMessage(d, ATTEMPT, STUDENT, { roomId: room.id, body: "A word, if you have one." });
    }
    return ok(await getState(d, ATTEMPT, STUDENT)).state;
  }

  it("rejects an option whose preconditions are not met (FR-14)", async () => {
    const { d } = deps();
    const state = ok(await getState(d, ATTEMPT, STUDENT)).state;
    const result = await postDecision(d, ATTEMPT, STUDENT, { optionId: state.options[0]!.id, optionsVersion: state.optionsVersion });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_option" } });
  });

  it("rejects a commit against an option set the world has moved past", async () => {
    const { d } = deps([openOwnDoor]);
    const stale = ok(await getState(d, ATTEMPT, STUDENT)).state.optionsVersion;
    const state = await unlockEverything(d);
    expect(state.optionsVersion).not.toBe(stale);
    const result = await postDecision(d, ATTEMPT, STUDENT, { optionId: state.options[0]!.id, optionsVersion: stale });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_option" } });
  });

  it("resolves into a public announcement, ticks the agents to decide, and never reveals their choice (D18)", async () => {
    const { d, store } = deps([openOwnDoor]);
    const state = await unlockEverything(d);
    expect(state.commitments.map((c) => c.actorKind)).toEqual(["player", "agent", "agent", "agent"]);
    expect(state.commitments.every((c) => !c.committed)).toBe(true);

    const option = state.options.find((o) => o.available)!;
    const result = ok(await postDecision(d, ATTEMPT, STUDENT, { optionId: option.id, optionsVersion: state.optionsVersion }));
    expect(result.value.announcement.length).toBeGreaterThan(0);
    expect(result.value.nextStageId).toBe(
      spec.stages[0]!.decision.options.find((o) => o.id === option.id)!.branchTarget.kind === "stage"
        ? (spec.stages[0]!.decision.options.find((o) => o.id === option.id)!.branchTarget as { stageId: string }).stageId
        : null,
    );
    expect(result.state.stage.index).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/"roll"|rationale|optionId":"opt-/);

    const saved = store.saved.at(-1)!;
    expect(saved.events.resolution?.stageIndex).toBe(0);
    const decided = saved.events.decisions.map((x) => x.decision);
    expect(decided.find((x) => x.actorId === "player")).toMatchObject({ how: "committed", optionId: option.id });
    expect(decided.filter((x) => x.actorKind === "agent")).toHaveLength(3);
    expect(saved.events.openedStageIndex).toBe(1);
    expect(findForbiddenKeys(result)).toEqual([]);
  });

  it("plays the fixture to an ending, after which the attempt is closed to further play", async () => {
    const { d, store } = deps(Array(200).fill(JSON.stringify({ say: "So be it.", actions: [] })));
    let guard = 0;
    for (;;) {
      const state = ok(await getState(d, ATTEMPT, STUDENT)).state;
      if (state.status === "completed" || guard++ > 6) break;
      for (const item of spec.stages[state.stage.index]!.evidence) {
        const here = ok(await getState(d, ATTEMPT, STUDENT)).state.currentRoomId;
        if (here !== item.roomId) {
          const moved = ok(await postAction(d, ATTEMPT, STUDENT, { type: "move_room", toRoomId: item.roomId }));
          if (moved.value.refused) continue; // behind a closed door nobody opens in this run
        }
        await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: item.id });
      }
      const ready = ok(await getState(d, ATTEMPT, STUDENT)).state;
      const option = ready.options.find((o) => o.available);
      if (!option) {
        // Nothing reachable unlocks an option: the timer is what ends such a stage (D12).
        store.add(record({ snapshot: store.saved.at(-1)!.snapshot, stageDeadlineAt: "2026-09-22T11:00:00.000Z" }));
        continue;
      }
      ok(await postDecision(d, ATTEMPT, STUDENT, { optionId: option.id, optionsVersion: ready.optionsVersion }));
    }
    const final = ok(await getState(d, ATTEMPT, STUDENT)).state;
    expect(final.status).toBe("completed");
    expect(final.ending).not.toBeNull();
    expect(spec.endings.map((e) => e.id)).toContain(final.ending!.id);
    expect(final.map).toBeNull();
    expect(store.saved.some((s) => s.events.endingId === final.ending!.id)).toBe(true);

    const after = await postMessage(d, ATTEMPT, STUDENT, { roomId: "anywhere", body: "hello?" });
    expect(after).toMatchObject({ ok: false, error: { code: "stage_closed" } });
  });
});

describe("server authority (FR-21)", () => {
  it("leaks no private context, roll or rationale in any response, and resumes identically from the store", async () => {
    const { d, store } = deps();
    const first = ok(await getState(d, ATTEMPT, STUDENT));
    const state = first.state;
    const msg = ok(await postMessage(d, ATTEMPT, STUDENT, { roomId: state.currentRoomId!, body: "Who holds the island?" }));
    const spoken = ok(await postAction(d, ATTEMPT, STUDENT, { type: "position", position: { x: 5, y: 6 } }));
    for (const payload of [first, msg, spoken]) expect(findForbiddenKeys(payload)).toEqual([]);
    expect(JSON.stringify([first, msg, spoken])).not.toMatch(/Privately thinks|hiddenInterests|knowledgeHorizon/);

    // A second load from what was saved reproduces the same public state (P7).
    const again = ok(await getState(d, ATTEMPT, STUDENT)).state;
    expect(again.transcript).toEqual(spoken.state.transcript);
    expect(again.playerPos).toEqual({ x: 5, y: 6 });
    expect(again.revision).toBe(spoken.state.revision);
    expect(store.saved.length).toBeGreaterThanOrEqual(3);
  });
});
