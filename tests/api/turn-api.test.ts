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
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadI1Spec } from "@adventure/generation/fixtures";
import { auditClientPayload, FakeLlmClient } from "@adventure/orchestration";
import type { AdventureSpec } from "@adventure/generation/spec";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getState, postAction, postDecision, postMessage, type PlayServiceDeps } from "@/lib/play/service";
import { publicJson } from "@/lib/play/http";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";
import { findForbiddenKeys, publicAttemptStateSchema } from "@/lib/turn-api/contract";
import { AdmissionRefusedError, enterRoom, inspectEvidence, stateOf, talkToAgent, walkTo, type PlayDriver } from "./play-driver";

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

function privateSecrets(currentSpec: AdventureSpec, store: MemoryPlayStore): string[] {
  const context = currentSpec.stages.flatMap((stage) =>
    stage.agents.flatMap((agent) => [
      agent.privateContext.persona,
      agent.privateContext.motivations,
      agent.privateContext.hiddenInterests,
      agent.privateContext.knowledgeHorizon,
    ]),
  );
  const rationales = store.saved.flatMap((entry) => {
    const rationale = entry.events.resolution?.record.rationale;
    return rationale === undefined ? [] : [rationale];
  });
  const secrets = [...new Set([...context, ...rationales])];
  expect(
    secrets.filter((secret) => secret.trim().length >= 8).length,
    "Private-text audit is toothless without at least four usable secrets.",
  ).toBeGreaterThan(3);
  return secrets;
}

function expectAudited(label: string, payload: unknown, secrets: readonly string[]): void {
  const report = auditClientPayload(payload, secrets);
  expect(report.ok, `${label}: ${JSON.stringify(report)}`).toBe(true);
}

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

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
    runtimeRevision: 0,
    ...overrides,
  };
}

function deps(replies: (string | ((request: { user: string }) => string))[] = Array(60).fill(say("The river mouth is ours to give or keep.")), overrides?: Partial<AttemptRecord>) {
  const store = new MemoryPlayStore([record(overrides)]);
  const llm = new FakeLlmClient({ replies });
  const d: PlayServiceDeps = { store, llm };
  return { d, store };
}

function driverFor(d: PlayServiceDeps, store: MemoryPlayStore): PlayDriver {
  let now = Date.parse("2026-09-22T12:00:00.000Z");
  return { deps: d, attemptId: ATTEMPT, userId: STUDENT, advanceTime: () => { now += 160; store.clock = () => new Date(now); } };
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
    expect(result.state.player).toEqual(spec.player);
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
    const driver = driverFor(d, store);
    const state = await stateOf(driver);
    const agent = state.actors.find((actor) => actor.kind === "agent")!;
    await walkTo(driver, agent.position!);
    const near = await stateOf(driver);
    const result = ok(await postMessage(d, ATTEMPT, STUDENT, { roomId: near.currentRoomId!, body: "What do you make of the island?", addresseeId: agent.id }));
    expect(result.value.map((m) => m.authorType)).toEqual(["player", "agent"]);
    expect(result.value[1]!.body).toBe("The river mouth is ours to give or keep.");
    expect(result.state.transcript).toHaveLength(2);
    expect(findForbiddenKeys(result)).toEqual([]);
    expect(store.saved.flatMap((entry) => entry.events.utterances)).toHaveLength(2);
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
    const stage = spec.stages[0]!;
    const closed = stage.rooms.find((r) => r.doorDefault === "closed")!;
    const { d: knocker, store } = deps(Array(8).fill(opener(closed.id)));
    const driver = driverFor(knocker, store);
    const map = (await stateOf(driver)).map!;
    const door = map.doors.find((candidate) => candidate.roomId === closed.id)!;
    await walkTo(driver, door.outside);
    const before = await stateOf(driver);
    await driver.advanceTime();
    const refused = ok(await postAction(knocker, ATTEMPT, STUDENT, { type: "move_step", stageId: before.stage.id, from: before.playerPos!, to: door.position }));
    expect(refused.value.refused).toMatch(/closed|invalid spatial step/);
    const knocked = ok(await postAction(knocker, ATTEMPT, STUDENT, { type: "knock", roomId: closed.id }));
    expect(knocked.state.rooms.find((r) => r.id === closed.id)?.doorOpen).toBe(true);
    const moved = await enterRoom(driver, closed.id);
    expect(moved.currentRoomId).toBe(closed.id);
    expect(moved.playerPos).toEqual(door.inside);
  });

  it("makes an option available once its evidence is examined (FR-14), and records the find in the journal", async () => {
    const { d, store } = deps();
    const driver = driverFor(d, store);
    const stage = spec.stages[0]!;
    const before = await stateOf(driver);
    expect(before.options.every((o) => !o.available)).toBe(true);
    expect(before.options[0]!.unavailableReason).not.toMatch(/precondition|evidence/i);

    const item = stage.evidence.find((e) => e.roomId === stage.spawnRoomId)!;
    const shown = (await stateOf(driver)).evidenceHere;
    expect(shown.map((e) => e.id)).toContain(item.id);
    const inspected = await inspectEvidence(driver, item.id);
    expect(inspected.journal.map((j) => j.id)).toContain(item.id);
    expect(inspected.journal[0]!.sourceSpan).toMatch(/p\. \d+/);
    expect(inspected.evidenceHere.map((e) => e.id)).not.toContain(item.id);
    const objective = stage.objectives.find((o) => o.targetId === item.id);
    if (objective) expect(inspected.stage.objectives.find((o) => o.id === objective.id)?.met).toBe(true);
  });

  it("refuses to examine evidence from another room", async () => {
    const { d } = deps();
    const stage = spec.stages[0]!;
    const elsewhere = stage.evidence.find((e) => e.roomId !== stage.spawnRoomId)!;
    const result = ok(await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: elsewhere.id }));
    expect(result.value.refused).toMatch(/closer|same room/);
    expect(result.state.journal).toHaveLength(0);
  });
});

describe("POST decision", () => {
  async function unlockEverything(d: PlayServiceDeps, store: MemoryPlayStore) {
    // Visit every room: examine its evidence and hear whoever is there (knows_evidence + heard_from, K6).
    const driver = driverFor(d, store);
    const rooms = (await stateOf(driver)).rooms;
    for (const room of rooms) {
      await enterRoom(driver, room.id);
      const state = await stateOf(driver);
      for (const item of state.evidenceHere) await inspectEvidence(driver, item.id);
      for (const agent of state.agents.filter((candidate) => state.hearingActorIds.includes(candidate.id))) await talkToAgent(driver, agent.id);
    }
    return stateOf(driver);
  }

  it("rejects an option whose preconditions are not met (FR-14)", async () => {
    const { d } = deps();
    const state = ok(await getState(d, ATTEMPT, STUDENT)).state;
    const result = await postDecision(d, ATTEMPT, STUDENT, { optionId: state.options[0]!.id, optionsVersion: state.optionsVersion });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_option" } });
  });

  it("rejects a commit against an option set the world has moved past", async () => {
    const { d, store } = deps([openOwnDoor]);
    const stale = ok(await getState(d, ATTEMPT, STUDENT)).state.optionsVersion;
    const state = await unlockEverything(d, store);
    expect(state.optionsVersion).not.toBe(stale);
    const result = await postDecision(d, ATTEMPT, STUDENT, { optionId: state.options[0]!.id, optionsVersion: stale });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_option" } });
  });

  it("resolves into a public announcement, ticks the agents to decide, and never reveals their choice (D18)", async () => {
    const { d, store } = deps([openOwnDoor]);
    const state = await unlockEverything(d, store);
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
    const driver = driverFor(d, store);
    let guard = 0;
    for (;;) {
      const state = await stateOf(driver);
      if (state.status === "completed" || guard++ > 6) break;
      for (const item of spec.stages[state.stage.index]!.evidence) {
        try {
          await enterRoom(driver, item.roomId);
          await inspectEvidence(driver, item.id);
        } catch (error) {
          if (error instanceof AdmissionRefusedError) continue;
          throw error;
        }
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
    const driver = driverFor(d, store);
    const firstState = await stateOf(driver);
    const first = { state: firstState };
    const agent = firstState.actors.find((actor) => actor.kind === "agent")!;
    await talkToAgent(driver, agent.id);
    const msg = ok(await postMessage(d, ATTEMPT, STUDENT, { roomId: (await stateOf(driver)).currentRoomId!, body: "Who holds the island?", addresseeId: agent.id }));
    const spoken = { state: await stateOf(driver) };
    for (const payload of [first, msg, spoken]) expect(findForbiddenKeys(payload)).toEqual([]);
    const secrets = privateSecrets(spec, store);
    expectAudited("state/message/resumed-state", [first, msg, spoken], secrets);

    // A second load from what was saved reproduces the same public state (P7).
    const again = ok(await getState(d, ATTEMPT, STUDENT)).state;
    expect(again.transcript).toEqual(spoken.state.transcript);
    expect(again.playerPos).toEqual(spoken.state.playerPos);
    expect(again.revision).toBe(spoken.state.revision);
    expect(store.saved.length).toBeGreaterThanOrEqual(3);
  });

  it("audits every reachable Turn API response shape", async () => {
    const { d, store } = deps([openOwnDoor]);
    const payloads: Array<[string, unknown]> = [];
    const collect = (label: string, payload: unknown) => payloads.push([label, payload]);

    const missing = await getState(d, ATTEMPT, OTHER);
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
    collect("getState/not_found", missing);

    const initial = await getState(d, ATTEMPT, STUDENT);
    expect(initial.ok).toBe(true);
    collect("getState/accepted", initial);
    if (!initial.ok) return;

    const roomId = initial.state.currentRoomId!;
    const acceptedMessage = await postMessage(d, ATTEMPT, STUDENT, { roomId, body: "What is being decided here?" });
    expect(acceptedMessage).toMatchObject({ ok: true });
    collect("postMessage/accepted", acceptedMessage);

    const driver = driverFor(d, store);
    const item = spec.stages[0]!.evidence.find((e) => e.roomId === roomId)!;
    const evidenceState = await stateOf(driver);
    const shown = evidenceState.evidenceHere.find((e) => e.id === item.id)!;
    if (shown.position && !shown.canInspect) await walkTo(driver, shown.position);
    const acceptedAction = await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: item.id });
    expect(acceptedAction).toMatchObject({ ok: true, value: { refused: null } });
    collect("postAction/accepted", acceptedAction);

    const elsewhere = spec.stages[0]!.evidence.find((e) => e.roomId !== roomId)!;
    const refusedAction = await postAction(d, ATTEMPT, STUDENT, { type: "inspect", evidenceId: elsewhere.id });
    expect(refusedAction).toMatchObject({ ok: true, value: { refused: expect.any(String) } });
    collect("postAction/refused", refusedAction);

    const invalidRequest = await postMessage(d, ATTEMPT, STUDENT, { roomId: "not-a-room", body: "hello" });
    expect(invalidRequest).toMatchObject({ ok: false, error: { code: "not_found" } });
    collect("postMessage/not_found", invalidRequest);

    const malformedMessage = await postMessage(d, ATTEMPT, STUDENT, { roomId, body: "   " });
    expect(malformedMessage).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    collect("postMessage/invalid_request", malformedMessage);

    const staleOption = await postDecision(d, ATTEMPT, STUDENT, {
      optionId: initial.state.options[0]!.id,
      optionsVersion: initial.state.optionsVersion,
    });
    expect(staleOption).toMatchObject({ ok: false, error: { code: "stale_option" } });
    collect("postDecision/stale_option", staleOption);

    const rooms = (await stateOf(driver)).rooms;
    for (const room of rooms) {
      await enterRoom(driver, room.id);
      const state = await stateOf(driver);
      for (const evidence of state.evidenceHere) await inspectEvidence(driver, evidence.id);
      for (const agent of state.agents.filter((candidate) => state.hearingActorIds.includes(candidate.id))) {
        await talkToAgent(driver, agent.id);
      }
    }
    const ready = await stateOf(driver);
    const option = ready.options.find((candidate) => candidate.available)!;
    const committed = await postDecision(d, ATTEMPT, STUDENT, {
      optionId: option.id,
      optionsVersion: ready.optionsVersion,
    });
    expect(committed).toMatchObject({ ok: true });
    collect("postDecision/accepted", committed);

    store.add(record({ status: "completed", snapshot: store.saved.at(-1)?.snapshot ?? null }));
    const stageClosed = await postAction(d, ATTEMPT, STUDENT, { type: "position", position: { x: 0, y: 0 } });
    expect(stageClosed).toMatchObject({ ok: false, error: { code: "stage_closed" } });
    collect("postAction/stage_closed", stageClosed);

    const secrets = privateSecrets(spec, store);
    for (const [label, payload] of payloads) expectAudited(label, payload, secrets);

    const secret = secrets.find((candidate) => candidate.trim().length >= 8);
    expect(secret, "The negative control needs a usable private secret.").toBeDefined();
    if (secret === undefined) return;
    const leaked = auditClientPayload({ state: { announcement: secret } }, secrets);
    expect(leaked.ok).toBe(false);
    expect(leaked.leakedText).toContain("$.state.announcement");
  });

  it("keeps every API route behind the response wrapper", () => {
    const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/web/src/app/api");
    for (const route of routeFiles(apiRoot)) {
      expect(readFileSync(route, "utf8"), `${route} must use publicJson/errorResponse`).not.toMatch(/NextResponse\.json\s*\(/);
    }
  });

  it("refuses a public payload carrying a forbidden key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = publicJson({ rationale: "server-only" });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "invalid_request", message: "Response withheld." } });
    } finally {
      error.mockRestore();
    }
  });
});
