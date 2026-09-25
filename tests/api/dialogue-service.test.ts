import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, spaceAt, type Point } from "@adventure/game-core";
import { moveActorStep, type LlmClient, type LlmResponse } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { postAction, postMessage, getState, type PlayServiceDeps } from "@/lib/play/service";
import { PlaySession } from "@/lib/play/session";
import { MemoryPlayStore, PlayConflictError, type AttemptRecord } from "@/lib/play/store";
import { talkToAgent } from "./play-driver";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;
beforeAll(async () => { spec = await loadI1Spec(); });

const attemptId = "dialogue-service-attempt";
const studentId = "dialogue-service-student";

function seededStore<T extends LlmClient>(llm: T, Store = MemoryPlayStore) {
  const session = PlaySession.start(spec, attemptId, 1);
  const agentId = spec.stages[0]!.agents.find((agent) => {
    const point = session.world.spatial!.state.actors[agent.id];
    return point && findPath(session.world.spatial!.map, session.world.spatial!.state.doors, session.world.spatial!.state.actors.player!, point) !== null;
  })!.id;
  const agentPoint = session.world.spatial!.state.actors[agentId]!;
  const path = findPath(session.world.spatial!.map, session.world.spatial!.state.doors, session.world.spatial!.state.actors.player!, agentPoint)!;
  for (const point of path) moveActorStep(session.world, "player", point);
  const record: AttemptRecord = { attemptId, studentId, adventureId: spec.id, publishedVersion: 1, status: "active", stageDeadlineAt: null, spec, snapshot: session.snapshot(), runtimeRevision: 0 };
  const store = new Store([record]) as MemoryPlayStore;
  const deps: PlayServiceDeps = { store, llm };
  return { deps, store, roomId: session.world.location.player!, agentId };
}

class CountingClient implements LlmClient {
  calls = 0;
  started?: () => void;
  response: LlmResponse = { content: JSON.stringify({ say: "A considered answer.", actions: [] }), usage: { promptTokens: 1, completionTokens: 1 } };
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    this.started?.();
    return this.response;
  }
}

class FinalConflictStore extends MemoryPlayStore {
  failFinal = true;
  override async save(record: AttemptRecord, snapshot: AttemptRecord["snapshot"] extends infer _ ? NonNullable<AttemptRecord["snapshot"]> : never, events: Parameters<MemoryPlayStore["save"]>[2]) {
    if (this.failFinal && record.snapshot?.pendingReply && !snapshot.pendingReply) {
      this.failFinal = false;
      throw new PlayConflictError();
    }
    return super.save(record, snapshot, events);
  }
}

function outdoorTarget(session: PlaySession): Point {
  const map = session.world.spatial!.map;
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) if (spaceAt(map, { x, y })?.kind === "outdoor") return { x, y };
  throw new Error("no outdoor target");
}

async function walkAway(deps: PlayServiceDeps, store: MemoryPlayStore): Promise<Point> {
  const loaded = (await store.load(attemptId, studentId))!;
  const target = outdoorTarget(PlaySession.resume(loaded.spec, attemptId, 1, loaded.snapshot!));
  const path = findPath(loaded.snapshot!.world.spatial!.map, loaded.snapshot!.world.spatial!.state.doors, loaded.snapshot!.world.spatial!.state.actors.player!, target)!;
  let now = Date.parse("2026-09-22T12:00:00.000Z");
  for (const point of path) {
    now += 160;
    store.clock = () => new Date(now);
    const result = await postAction(deps, attemptId, studentId, { type: "move_step", stageId: loaded.spec.stages[loaded.snapshot!.stageIndex]!.id, from: (await store.load(attemptId, studentId))!.snapshot!.world.spatial!.state.actors.player!, to: point });
    expect(result).toEqual(expect.objectContaining({ ok: true, value: { refused: null } }));
  }
  return target;
}

describe("service dialogue lifecycle", () => {
  it("paces a two-reply NPC conversation after the speech burst is spent", async () => {
    const llm = new CountingClient();
    const { deps, store, roomId, agentId } = seededStore(llm);
    let now = Date.now();
    store.clock = () => new Date(now);
    for (let message = 0; message < 3; message += 1) {
      const result = await postMessage(deps, attemptId, studentId, { roomId, body: `Question ${message + 1}`, addresseeId: agentId });
      expect(result.ok).toBe(true);
    }

    let waits = 0;
    const state = await talkToAgent({
      deps, attemptId, userId: studentId,
      advanceTime: () => { now += 160; waits += 1; },
    }, agentId);
    expect(waits).toBeGreaterThan(0);
    expect(llm.calls).toBe(5);
    expect(state.transcript.filter((line) => line.authorType === "player")).toHaveLength(5);
  });

  it("persists the ticket before deferred production and keeps movement while the provider waits", async () => {
    let release!: (response: LlmResponse) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const llm: LlmClient = { complete: async () => { calls += 1; started(); return new Promise<LlmResponse>((resolve) => { release = resolve; }); } };
    const { deps, store, roomId, agentId } = seededStore(llm);
    const pending = postMessage(deps, attemptId, studentId, { roomId, body: "Answer me.", addresseeId: agentId });
    await startedPromise;
    expect((await store.load(attemptId, studentId))!.snapshot!.pendingReply).not.toBeNull();
    const movedTarget = await walkAway(deps, store);
    release({ content: JSON.stringify({ say: "Late answer.", actions: [] }), usage: { promptTokens: 1, completionTokens: 1 } });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
    const final = (await store.load(attemptId, studentId))!.snapshot!;
    expect(final.pendingReply).toBeNull();
    expect(final.world.spatial!.state.actors.player).toEqual(movedTarget);
    expect(final.world.transcript.some((line) => line.body === "Late answer.")).toBe(true);
    expect(result.ok && result.state.transcript.some((line) => line.body === "Late answer.")).toBe(false);
  });

  it("retries final CAS application without repeating the provider, while initial conflicts make no provider call", async () => {
    const llm = new CountingClient();
    const seeded = seededStore(llm, FinalConflictStore);
    const result = await postMessage(seeded.deps, attemptId, studentId, { roomId: seeded.roomId, body: "Retry this.", addresseeId: seeded.agentId });
    expect(result.ok).toBe(true);
    expect(llm.calls).toBe(1);
    expect((await seeded.store.load(attemptId, studentId))!.snapshot!.world.transcript.filter((line) => line.body === "A considered answer.")).toHaveLength(1);

    const initialLlm = new CountingClient();
    const initial = seededStore(initialLlm);
    const originalSave = initial.store.save.bind(initial.store);
    initial.store.save = async () => { throw new PlayConflictError(); };
    const conflict = await postMessage(initial.deps, attemptId, studentId, { roomId: initial.roomId, body: "Initial conflict.", addresseeId: initial.agentId });
    expect(conflict).toMatchObject({ ok: false, error: { code: "stale_state" } });
    expect(initialLlm.calls).toBe(0);
    void originalSave;
  });

  it("rejects another request while a reply is pending and accepts late completion", async () => {
    let release!: (response: LlmResponse) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const llm: LlmClient = { complete: async () => { calls += 1; started(); return new Promise<LlmResponse>((resolve) => { release = resolve; }); } };
    const { deps, store, roomId, agentId } = seededStore(llm);
    const first = postMessage(deps, attemptId, studentId, { roomId, body: "First.", addresseeId: agentId });
    await startedPromise;
    const second = await postMessage(deps, attemptId, studentId, { roomId, body: "Second.", addresseeId: agentId });
    expect(second).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    const broadcast = await postMessage(deps, attemptId, studentId, { roomId, body: "Ambient." });
    expect(broadcast).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(calls).toBe(1);
    const pending = (await store.load(attemptId, studentId))!.snapshot!.pendingReply!;
    store.clock = () => new Date(pending.expiresAt + 1);
    await getState(deps, attemptId, studentId);
    release({ content: JSON.stringify({ say: "Too late.", actions: [] }), usage: { promptTokens: 1, completionTokens: 1 } });
    await first;
    const final = (await store.load(attemptId, studentId))!.snapshot!;
    expect(final.pendingReply).toBeNull();
    expect(final.world.transcript.some((line) => line.body === "Too late.")).toBe(true);
  });
});
