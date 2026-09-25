import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, isWalkable } from "@adventure/game-core";
import { applyAction, auditClientPayload, FakeLlmClient, moveActorStep, type LlmClient, type LlmRequest, type LlmResponse, type MintedOption } from "@adventure/orchestration";
import type { AdventureSpec } from "@adventure/generation/spec";
import { beforeAll, describe, expect, it } from "vitest";

import { getState, postAction, postDecision, postMessage, postMintOptions, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore, PlayConflictError, type AttemptRecord } from "@/lib/play/store";
import { PlaySession } from "@/lib/play/session";
import { stateOf, walkTo, type PlayDriver } from "./play-driver";

const STUDENT = "student-mint";

let spec: AdventureSpec;

function record(attemptId: string, adventureSpec: AdventureSpec = spec): AttemptRecord {
  return {
    attemptId,
    studentId: STUDENT,
    adventureId: adventureSpec.id,
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec: adventureSpec,
    snapshot: null,
    runtimeRevision: 0,
  };
}

function mintReply(labels: readonly string[] = ["Offer a temporary anchorage"]): string {
  return JSON.stringify({ proposals: labels.map((label) => ({
    label,
    stance: "cooperative",
    branchTargetKey: "opt-sign-preliminary",
    preconditions: [{ kind: "actor_in_room", actorId: "player", roomId: "landing-beach" }],
    why: "The public exchange opened this route.",
  })) });
}

function deferredLlm(replies: readonly string[] = [mintReply()]) {
  const fake = new FakeLlmClient({ replies });
  const pending: Array<() => void> = [];
  const waiters = new Map<number, () => void>();
  const client: LlmClient = {
    complete: (request) => {
      const generated = fake.complete(request);
      if (request.schemaName !== "option_minting") return generated;
      let release!: () => void;
      const deferred = new Promise<LlmResponse>((resolve, reject) => {
        let response: LlmResponse | undefined;
        let released = false;
        release = () => {
          released = true;
          if (response !== undefined) resolve(response);
        };
        void generated.then((value) => {
          response = value;
          if (released) resolve(value);
        }, reject);
      });
      pending.push(release);
      for (const [count, resolve] of waiters) {
        if (pending.length >= count) {
          waiters.delete(count);
          resolve();
        }
      }
      return deferred;
    },
  };
  return {
    client,
    requests: fake.requests,
    waitForCalls: (count: number) => pending.length >= count ? Promise.resolve() : new Promise<void>((resolve) => waiters.set(count, resolve)),
    release: (index: number) => {
      const release = pending[index];
      if (!release) throw new Error(`no pending model call ${index}`);
      release();
    },
  };
}

function transcriptReadySession(attemptId: string, now: () => Date = () => new Date()): PlaySession {
  const session = PlaySession.start(spec, attemptId, 1, { now });
  const roomId = session.world.location.player!;
  for (let index = 0; index < 6; index += 1) {
    expect(applyAction(session.world, { actorKind: "player", actorId: "player", action: { type: "speak", roomId, body: `public line ${index}`, addresseeId: null } }).ok).toBe(true);
  }
  return session;
}

function walkPlayerToAgent(session: PlaySession, agentId: string): void {
  const spatial = session.world.spatial!;
  const path = findPath(spatial.map, spatial.state.doors, spatial.state.actors.player!, spatial.state.actors[agentId]!);
  if (!path) throw new Error(`no path to ${agentId}`);
  for (const point of path) expect(moveActorStep(session.world, "player", point).ok).toBe(true);
}

function storedMint(id: string, stageId: string): MintedOption {
  return {
    id,
    label: `Stored ${id}`,
    preconditions: [],
    branchTarget: { kind: "stage", stageId: "stage-sultan" },
    stance: "cooperative",
    stageId,
  };
}

function conflictOnNextSave(store: MemoryPlayStore): () => void {
  const save = store.save.bind(store);
  let rejectNextSave = false;
  store.save = async (record, snapshot, events) => {
    if (rejectNextSave) {
      rejectNextSave = false;
      const current = await store.load(record.attemptId, record.studentId);
      if (!current) throw new Error("attempt disappeared");
      store.add({ ...current, runtimeRevision: current.runtimeRevision + 1 });
      throw new PlayConflictError();
    }
    return save(record, snapshot, events);
  };
  return () => { rejectNextSave = true; };
}

function deps(attemptId: string, replies: readonly string[], adventureSpec: AdventureSpec = spec): { d: PlayServiceDeps; store: MemoryPlayStore; llm: FakeLlmClient } {
  const store = new MemoryPlayStore([record(attemptId, adventureSpec)]);
  const llm = new FakeLlmClient({ replies });
  return { d: { store, llm }, store, llm };
}

async function addPublicLines(d: PlayServiceDeps, store: MemoryPlayStore, attemptId: string, count = 6) {
  // Mint tests need public transcript input without starting the room's NPC reply flow.
  const record = (await store.load(attemptId, STUDENT))!;
  const session = record.snapshot
    ? PlaySession.resume(record.spec, attemptId, record.publishedVersion, record.snapshot, { now: store.clock })
    : PlaySession.start(record.spec, attemptId, record.publishedVersion, { now: store.clock });
  const roomId = session.world.location.player!;
  let now = store.clock().getTime();
  for (let index = 0; index < count; index += 1) {
    now += 5000;
    store.clock = () => new Date(now);
    const body = index === 0 ? "The negotiation continues." : `The negotiation continues, line ${index}.`;
    expect(applyAction(session.world, { actorKind: "player", actorId: "player", action: { type: "speak", roomId, body, addresseeId: null } }).ok).toBe(true);
  }
  store.add({ ...record, snapshot: session.snapshot(), runtimeRevision: record.runtimeRevision + 1 });
  return getState(d, attemptId, STUDENT);
}

beforeAll(async () => {
  spec = await loadI1Spec();
});

describe("in-memory Resolver option minting", () => {
  it("returns chat before minting, then stores options hidden by unmet goals", async () => {
    const { d, store, llm } = deps("mint-hidden", [mintReply()]);
    const initial = await getState(d, "mint-hidden", STUDENT);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const afterMessages = await addPublicLines(d, store, "mint-hidden");
    expect(afterMessages.ok, JSON.stringify(afterMessages)).toBe(true);
    if (!afterMessages.ok) return;
    expect(afterMessages.state.mintReady).toBe(true);
    expect(llm.requests).toHaveLength(0);

    const read = await getState(d, "mint-hidden", STUDENT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.state.mintReady).toBe(true);
    expect(llm.requests).toHaveLength(0);

    const minted = await postMintOptions(d, "mint-hidden", STUDENT);
    expect(minted.ok, JSON.stringify(minted)).toBe(true);
    if (!minted.ok) return;
    expect(minted.state.options.some((option) => option.id.startsWith("minted-"))).toBe(false);
    expect(store.saved.at(-1)?.snapshot.mintedOptions).toHaveLength(1);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]).toMatchObject({ model: "gpt-6-sol", schemaName: "option_minting" });

    const afterRead = await getState(d, "mint-hidden", STUDENT);
    expect(afterRead.ok).toBe(true);
    expect(llm.requests).toHaveLength(1);
  });

  it("keeps GET side-effect-free and resumes stored minted ids while keeping them hidden", async () => {
    const { d, store, llm } = deps("mint-resume", [mintReply()]);
    const afterMessages = await addPublicLines(d, store, "mint-resume");
    expect(afterMessages.ok, JSON.stringify(afterMessages)).toBe(true);
    if (!afterMessages.ok) return;
    expect(afterMessages.state.mintReady).toBe(true);
    expect(llm.requests).toHaveLength(0);
    const beforeMintRead = await getState(d, "mint-resume", STUDENT);
    expect(beforeMintRead.ok).toBe(true);
    expect(llm.requests).toHaveLength(0);

    const minted = await postMintOptions(d, "mint-resume", STUDENT);
    expect(minted.ok, JSON.stringify(minted)).toBe(true);
    if (!minted.ok) return;
    const storedIds = store.saved.at(-1)?.snapshot.mintedOptions?.map((option) => option.id);
    expect(storedIds).toHaveLength(1);
    expect(minted.state.options.filter((option) => option.id.startsWith("minted-"))).toEqual([]);
    const requestsBeforeRead = llm.requests.length;
    const resumed = await getState(d, "mint-resume", STUDENT);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.state.options.filter((option) => option.id.startsWith("minted-"))).toEqual([]);
    expect(resumed.state.optionsVersion).toBe(minted.state.optionsVersion);
    expect(llm.requests).toHaveLength(requestsBeforeRead);
    expect(store.saved.at(-1)?.snapshot.mintedOptions?.map((option) => option.id)).toEqual(storedIds);
  });

  it("returns a begin-save conflict without calling the mint model", async () => {
    const attemptId = "mint-begin-conflict";
    const store = new MemoryPlayStore([record(attemptId)]);
    const conflict = conflictOnNextSave(store);
    const llm = new FakeLlmClient({ replies: [mintReply()] });
    const d: PlayServiceDeps = { store, llm };
    const afterMessages = await addPublicLines(d, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    conflict();

    const result = await postMintOptions(d, attemptId, STUDENT);

    expect(result).toMatchObject({ ok: false, error: { code: "stale_state" } });
    expect(llm.requests).toHaveLength(0);
  });

  it("waits for a live addressed reply before marking mint ready", async () => {
    const session = transcriptReadySession("mint-pending-reply");
    const objective = spec.stages[0]!.objectives.find((candidate) => (
      candidate.requires.length === 0 && spec.stages[0]!.agents.some((agent) => agent.id === candidate.targetId)
    ))!;
    const agentId = objective.targetId;
    walkPlayerToAgent(session, agentId);
    const roomId = session.world.location.player!;
    const begun = session.beginMessage({ roomId, body: "Please give me your assessment.", addresseeId: agentId });
    expect(begun.ok).toBe(true);
    if (!begun.ok || !begun.ticket) return;
    expect(session.mintReady()).toBe(false);

    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "I hear you.", actions: [] })] });
    const reply = await session.produceReply(llm, begun.ticket);
    expect(session.completeReply(begun.ticket, reply).ok).toBe(true);
    expect(llm.requests).toHaveLength(1);
    expect(session.mintReady()).toBe(true);
  });

  it("retries a conflicting message begin without duplicating the utterance or losing goal proof", async () => {
    const attemptId = "mint-message-begin-conflict";
    const store = new MemoryPlayStore([record(attemptId)]);
    const conflict = conflictOnNextSave(store);
    const objective = spec.stages[0]!.objectives.find((candidate) => candidate.id === "obj-hear-farquhar")!;
    const say = "The sheltered river mouth could support a British trading post.";
    const body = "My notes identify the sheltered river mouth. What could it support?";
    const model = deferredLlm([
      mintReply(),
      JSON.stringify({ say: "What have you learned about the harbor?", actions: [] }),
      JSON.stringify({ say, actions: [{ type: "goal_evidence", objectiveId: objective.id, quote: say }] }),
    ]);
    const requests = model.requests;
    const d: PlayServiceDeps = { store, llm: model.client };
    const afterMessages = await addPublicLines(d, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    const minting = postMintOptions(d, attemptId, STUDENT);
    await model.waitForCalls(1);
    let now = store.clock().getTime();
    const driver: PlayDriver = {
      deps: d,
      attemptId,
      userId: STUDENT,
      advanceTime: () => { now += 160; store.clock = () => new Date(now); },
    };
    const initial = await stateOf(driver);
    const farquhar = initial.actors.find((actor) => actor.id === objective.targetId)!;
    await walkTo(driver, farquhar.position!);
    const near = await stateOf(driver);
    const opening = await postMessage(d, attemptId, STUDENT, {
      roomId: near.currentRoomId!, body: "How do you assess this harbor?", addresseeId: objective.targetId,
    });
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    conflict();

    const message = await postMessage(d, attemptId, STUDENT, { roomId: near.currentRoomId!, body, addresseeId: objective.targetId });
    expect(message.ok).toBe(true);
    if (!message.ok) return;
    expect(message.state.stage.objectives.find((candidate) => candidate.id === objective.id)?.met).toBe(true);
    expect(requests.filter((request) => request.schemaName === "character_agent_reply")).toHaveLength(2);
    expect(requests.filter((request) => request.schemaName === "option_minting")).toHaveLength(1);
    let snapshot = (await store.load(attemptId, STUDENT))!.snapshot!;
    expect(snapshot.world.transcript.filter((line) => line.speakerId === "player" && line.body === body)).toHaveLength(1);
    expect(snapshot.world.transcript.find((line) => line.speakerId === objective.targetId && line.body === say)?.goalIds).toEqual([objective.id]);
    expect(snapshot.pendingMint).not.toBeNull();

    model.release(0);
    const completedMint = await minting;
    expect(completedMint.ok).toBe(true);
    if (!completedMint.ok) return;
    snapshot = (await store.load(attemptId, STUDENT))!.snapshot!;
    expect(snapshot.world.transcript.filter((line) => line.speakerId === "player" && line.body === body)).toHaveLength(1);
    expect(snapshot.world.transcript.find((line) => line.speakerId === objective.targetId && line.body === say)?.goalIds).toEqual([objective.id]);
  });

  it("uses the persisted mint lease to avoid duplicate model calls across concurrent posts", async () => {
    const attemptId = "mint-concurrent";
    const store = new MemoryPlayStore([record(attemptId)]);
    const model = deferredLlm();
    const d: PlayServiceDeps = { store, llm: model.client };
    const afterMessages = await addPublicLines(d, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    expect(afterMessages.state.mintReady).toBe(true);

    const first = postMintOptions(d, attemptId, STUDENT);
    await model.waitForCalls(1);
    const second = await postMintOptions(d, attemptId, STUDENT);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.mintReady).toBe(false);
    expect(model.requests).toHaveLength(1);

    model.release(0);
    const completed = await first;
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(store.saved.at(-1)?.snapshot.mintedOptions).toHaveLength(1);
    expect(store.saved.at(-1)?.snapshot.pendingMint).toBeNull();
    expect(store.saved.at(-1)?.snapshot.world.transcript).toHaveLength(6);
  });

  it("allows a new POST to claim an expired lease and discards the old output", async () => {
    const attemptId = "mint-expired-lease";
    const store = new MemoryPlayStore([record(attemptId)]);
    const model = deferredLlm([mintReply(["Expired lease route"]), mintReply(["Fresh lease route"])]);
    const d: PlayServiceDeps = { store, llm: model.client };
    const ready = await addPublicLines(d, store, attemptId);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;

    const oldRequest = postMintOptions(d, attemptId, STUDENT);
    await model.waitForCalls(1);
    const nextTime = store.clock().getTime() + 180_000;
    store.clock = () => new Date(nextTime);
    const expired = await getState(d, attemptId, STUDENT);
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.state.mintReady).toBe(true);

    const retry = postMintOptions(d, attemptId, STUDENT);
    await model.waitForCalls(2);
    model.release(1);
    const retried = await retry;
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    model.release(0);
    const stale = await oldRequest;
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(model.requests).toHaveLength(2);
    expect(store.saved.at(-1)?.snapshot.mintedOptions?.map((option) => option.label)).toEqual(["Fresh lease route"]);
  });

  it("retries a final save conflict using the same mint output", async () => {
    const attemptId = "mint-final-conflict";
    const store = new MemoryPlayStore([record(attemptId)]);
    const save = store.save.bind(store);
    let rejectNextSave = false;
    store.save = async (record, snapshot, events) => {
      if (rejectNextSave) {
        rejectNextSave = false;
        const current = await store.load(record.attemptId, record.studentId);
        if (!current) throw new Error("attempt disappeared");
        store.add({ ...current, runtimeRevision: current.runtimeRevision + 1 });
        throw new PlayConflictError();
      }
      return save(record, snapshot, events);
    };
    const fake = new FakeLlmClient({ replies: [mintReply()] });
    const client: LlmClient = {
      complete: async (request) => {
        const response = await fake.complete(request);
        if (request.schemaName === "option_minting") rejectNextSave = true;
        return response;
      },
    };
    const d: PlayServiceDeps = { store, llm: client };
    const afterMessages = await addPublicLines(d, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    const result = await postMintOptions(d, attemptId, STUDENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.requests).toHaveLength(1);
    expect(store.saved.at(-1)?.snapshot.mintedOptions).toHaveLength(1);
    expect(store.saved.at(-1)?.snapshot.world.transcript).toHaveLength(6);
  });

  it("retries a pure move conflict while preserving the mint lease", async () => {
    const attemptId = "mint-move-conflict";
    const store = new MemoryPlayStore([record(attemptId)]);
    const conflict = conflictOnNextSave(store);
    const model = deferredLlm();
    const d: PlayServiceDeps = { store, llm: model.client };
    const afterMessages = await addPublicLines(d, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    const minting = postMintOptions(d, attemptId, STUDENT);
    await model.waitForCalls(1);

    const before = (await store.load(attemptId, STUDENT))!.snapshot!;
    const spatial = before.world.spatial!;
    const from = spatial.state.actors.player!;
    const to = [
      { x: from.x + 1, y: from.y },
      { x: from.x - 1, y: from.y },
      { x: from.x, y: from.y + 1 },
      { x: from.x, y: from.y - 1 },
    ].find((point) => isWalkable(spatial.map, spatial.state.doors, point))!;
    const pendingMintId = before.pendingMint?.id;
    conflict();

    const moved = await postAction(d, attemptId, STUDENT, { type: "move_step", stageId: spec.stages[0]!.id, from, to });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.refused).toBeNull();
    expect(moved.state.playerPos).toEqual(to);
    let snapshot = (await store.load(attemptId, STUDENT))!.snapshot!;
    expect(snapshot.pendingMint?.id).toBe(pendingMintId);
    expect(snapshot.world.spatial!.state.actors.player).toEqual(to);
    expect(snapshot.world.transcript).toHaveLength(6);
    expect(model.requests).toHaveLength(1);

    model.release(0);
    const minted = await minting;
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    snapshot = (await store.load(attemptId, STUDENT))!.snapshot!;
    expect(snapshot.world.spatial!.state.actors.player).toEqual(to);
    expect(model.requests).toHaveLength(1);
  });

  it("discards a stale mint result after the player advances to another stage", async () => {
    const stageSpec = structuredClone(spec);
    stageSpec.stages[0]!.decision.requires = [];
    stageSpec.stages[0]!.decision.options.find((option) => option.id === "opt-land-troops")!.branchTarget = { kind: "stage", stageId: "stage-sultan" };
    const attemptId = "mint-stage-change";
    const store = new MemoryPlayStore([record(attemptId, stageSpec)]);
    const model = deferredLlm([mintReply(["Stale stage option"])]);
    const mintDeps: PlayServiceDeps = { store, llm: model.client };
    const afterMessages = await addPublicLines(mintDeps, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    const minting = postMintOptions(mintDeps, attemptId, STUDENT);
    await model.waitForCalls(1);

    const current = await getState(mintDeps, attemptId, STUDENT);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    const option = current.state.options.find((candidate) => candidate.id === "opt-land-troops")!;
    expect(option.available).toBe(true);
    const decision = await postDecision({ store, llm: new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [{ type: "yield" }] })] }) }, attemptId, STUDENT, {
      optionId: option.id,
      optionsVersion: current.state.optionsVersion,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.state.stage.id).toBe("stage-sultan");

    model.release(0);
    const discarded = await minting;
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.stage.id).toBe("stage-sultan");
    expect(store.saved.at(-1)?.snapshot.mintedOptions).toEqual([]);
    expect(store.saved.at(-1)?.snapshot.pendingMint).toBeNull();
    expect(model.requests).toHaveLength(1);
  });

  it("rechecks minted preconditions against the world after a player move", async () => {
    const attemptId = "mint-world-changed";
    const store = new MemoryPlayStore([record(attemptId)]);
    const model = deferredLlm([mintReply(["The player moved away"])]);
    const d: PlayServiceDeps = { store, llm: model.client };
    const afterMessages = await addPublicLines(d, store, attemptId);
    expect(afterMessages.ok).toBe(true);
    if (!afterMessages.ok) return;
    const minting = postMintOptions(d, attemptId, STUDENT);
    await model.waitForCalls(1);

    let now = store.clock().getTime();
    const driver: PlayDriver = {
      deps: d,
      attemptId,
      userId: STUDENT,
      advanceTime: () => { now += 160; store.clock = () => new Date(now); },
    };
    const current = await stateOf(driver);
    const target = current.actors.find((actor) => actor.id === "agent-temenggong-s0")!;
    expect(target.position).not.toBeNull();
    await walkTo(driver, target.position!);
    expect((await stateOf(driver)).currentRoomId).toBe("temenggong-hall");

    model.release(0);
    const completed = await minting;
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.state.currentRoomId).toBe("temenggong-hall");
    expect(store.saved.at(-1)?.snapshot.mintedOptions).toEqual([]);
    expect(store.saved.at(-1)?.snapshot.mintedAtSeq).toBe(6);
    expect(model.requests).toHaveLength(1);
  });

  it("keeps minted options stored but unavailable until every required objective is met", async () => {
    const gateSpec = structuredClone(spec);
    const stage = gateSpec.stages[0]!;
    const required = stage.objectives.find((objective) => objective.id === "obj-read-instructions")!;
    stage.decision.requires = [required.id];
    const minted: MintedOption = {
      id: "minted-stage-landing-gate-test",
      label: "Offer a temporary anchorage",
      preconditions: [],
      branchTarget: { kind: "stage", stageId: "stage-sultan" },
      stance: "cooperative",
      stageId: stage.id,
    };
    const started = PlaySession.start(gateSpec, "mint-decision-gate", 1);
    const snapshot = started.snapshot();
    snapshot.mintedOptions = [minted];
    const blocked = PlaySession.resume(gateSpec, "mint-decision-gate", 1, snapshot);
    const blockedState = blocked.state({ enabled: false, deadlineAt: null });

    expect(blockedState.options.some((option) => option.id === minted.id)).toBe(false);
    expect(blocked.snapshot().mintedOptions).toEqual([minted]);
    expect(await blocked.decide(new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [{ type: "yield" }] })] }), minted.id, blockedState.optionsVersion))
      .toMatchObject({ ok: false, error: { code: "not_found" } });

    const satisfied = blocked.snapshot();
    satisfied.world.evidenceKnown.player = [...(satisfied.world.evidenceKnown.player ?? []), required.targetId];
    const unblocked = PlaySession.resume(gateSpec, "mint-decision-gate", 1, satisfied);
    const unblockedState = unblocked.state({ enabled: false, deadlineAt: null });
    expect(unblockedState.stage.objectives.find((objective) => objective.id === required.id)?.met).toBe(true);
    expect(unblockedState.options.find((option) => option.id === minted.id)).toMatchObject({ available: true });
    expect(unblocked.snapshot().mintedOptions).toEqual([minted]);
    expect(await unblocked.decide(new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [{ type: "yield" }] })] }), minted.id, unblockedState.optionsVersion)).toMatchObject({ ok: true });
  });

  it("commits a minted option, follows its authored branch, caps minting, and clears it on the next stage", async () => {
    const noGoalGateSpec = structuredClone(spec);
    noGoalGateSpec.stages[0]!.decision.requires = [];
    const { d, store, llm } = deps("mint-commit", [
      mintReply(["Offer a temporary anchorage"]),
      mintReply(["Open a second channel", "Invent a third route"]),
    ], noGoalGateSpec);
    const after = await addPublicLines(d, store, "mint-commit");
    expect(after.ok, JSON.stringify(after)).toBe(true);
    if (!after.ok) return;
    expect(after.state.mintReady).toBe(true);
    expect(llm.requests).toHaveLength(0);
    expect((await postMintOptions(d, "mint-commit", STUDENT)).ok).toBe(true);
    expect(llm.requests).toHaveLength(1);
    const secondMessages = await addPublicLines(d, store, "mint-commit");
    expect(secondMessages.ok, JSON.stringify(secondMessages)).toBe(true);
    if (!secondMessages.ok) return;
    expect(secondMessages.state.mintReady).toBe(true);
    expect(llm.requests).toHaveLength(1);
    const secondRound = await postMintOptions(d, "mint-commit", STUDENT);
    expect(secondRound.ok, JSON.stringify(secondRound)).toBe(true);
    if (!secondRound.ok) return;
    expect(llm.requests).toHaveLength(2);
    const minted = secondRound.state.options.filter((option) => option.id.startsWith("minted-"));
    expect(minted).toHaveLength(2);
    expect(minted.every((option) => option.available)).toBe(true);

    const committed = await postDecision(d, "mint-commit", STUDENT, {
      optionId: minted[0]!.id,
      optionsVersion: secondRound.state.optionsVersion,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.state.stage.index).toBe(1);
    expect(committed.state.options.every((option) => !option.id.startsWith("minted-"))).toBe(true);
    expect(committed.value.nextStageId).toBe("stage-sultan");
  });

  it("finalizes garbage mint output once and does not retry the same transcript batch", async () => {
    const { d, store, llm } = deps("mint-garbage", ["not json"]);
    const afterMessages = await addPublicLines(d, store, "mint-garbage");

    expect(afterMessages.ok, JSON.stringify(afterMessages)).toBe(true);
    if (!afterMessages.ok) return;
    expect(llm.requests).toHaveLength(0);
    const failed = await postMintOptions(d, "mint-garbage", STUDENT);
    expect(failed.ok, JSON.stringify(failed)).toBe(true);
    if (!failed.ok) return;
    expect(failed.state.options.some((option) => option.id.startsWith("minted-"))).toBe(false);
    expect(failed.state.mintReady).toBe(false);
    expect(store.saved.at(-1)?.snapshot.mintedAtSeq).toBe(6);
    expect(llm.requests).toHaveLength(3);
    const repeated = await postMintOptions(d, "mint-garbage", STUDENT);
    expect(repeated.ok).toBe(true);
    expect(llm.requests).toHaveLength(3);
  });

  it("retries a failed mint only after a new transcript batch is ready", async () => {
    const { d, store, llm } = deps("mint-failure-retry", ["not json", "not json", "not json", mintReply()]);
    const firstBatch = await addPublicLines(d, store, "mint-failure-retry");
    expect(firstBatch.ok).toBe(true);
    if (!firstBatch.ok) return;
    const failed = await postMintOptions(d, "mint-failure-retry", STUDENT);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.state.mintReady).toBe(false);
    expect(llm.requests).toHaveLength(3);
    expect((await postMintOptions(d, "mint-failure-retry", STUDENT)).ok).toBe(true);
    expect(llm.requests).toHaveLength(3);

    const laterBatch = await addPublicLines(d, store, "mint-failure-retry");
    expect(laterBatch.ok).toBe(true);
    if (!laterBatch.ok) return;
    expect(laterBatch.state.mintReady).toBe(true);
    const retried = await postMintOptions(d, "mint-failure-retry", STUDENT);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(llm.requests).toHaveLength(4);
    expect(store.saved.at(-1)?.snapshot.mintedOptions).toHaveLength(1);
  });

  it("gates mint readiness on stage state, player decision, budget, transcript, and cap", () => {
    const attemptId = "mint-ready-gates";
    let now = Date.parse("2026-09-22T12:00:00.000Z");
    const ready = transcriptReadySession(attemptId, () => new Date(now));
    const snapshot = ready.snapshot();
    const resume = (value: typeof snapshot) => PlaySession.resume(spec, attemptId, 1, value, { now: () => new Date(now) });

    expect(PlaySession.start(spec, "mint-ready-short", 1).mintReady()).toBe(false);
    expect(ready.mintReady()).toBe(true);

    const capped = structuredClone(snapshot);
    capped.mintedOptions = [storedMint("minted-one", spec.stages[0]!.id), storedMint("minted-two", spec.stages[0]!.id)];
    expect(resume(capped).mintReady()).toBe(false);

    const spent = structuredClone(snapshot);
    spent.stageStats.tokens = 60_000;
    expect(resume(spent).mintReady()).toBe(false);

    const decided = structuredClone(snapshot);
    decided.decisions = [{ actorId: "player", actorKind: "player", optionId: null, how: "passed" }];
    expect(resume(decided).mintReady()).toBe(false);

    const completed = structuredClone(snapshot);
    completed.status = "completed";
    completed.endingId = spec.endings[0]!.id;
    expect(resume(completed).mintReady()).toBe(false);
  });

  it("uses an exact 180-second lease and permits retry only after expiry", () => {
    let now = Date.parse("2026-09-22T12:00:00.000Z");
    const session = transcriptReadySession("mint-lease-expiry", () => new Date(now));
    const ticket = session.beginMint()!;

    expect(ticket.expiresAt).toBe(now + 180_000);
    expect(session.mintReady()).toBe(false);
    now += 179_999;
    expect(session.mintReady()).toBe(false);
    now += 1;
    expect(session.mintReady()).toBe(true);
    const renewed = session.beginMint()!;
    expect(renewed.id).not.toBe(ticket.id);
    expect(session.completeMint(ticket, { options: [storedMint("minted-stale", ticket.stageId)], tokens: 1 })).toBe(false);
    expect(session.snapshot().pendingMint?.id).toBe(renewed.id);
  });

  it("counts mint tokens against stage telemetry and keeps the minted state auditable", async () => {
    const { d, store } = deps("mint-budget", [mintReply()]);
    const afterMessages = await addPublicLines(d, store, "mint-budget");

    expect(afterMessages.ok, JSON.stringify(afterMessages)).toBe(true);
    if (!afterMessages.ok) return;
    expect(afterMessages.state.mintReady).toBe(true);
    const result = await postMintOptions(d, "mint-budget", STUDENT);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const snapshot = store.saved.at(-1)!.snapshot;
    expect(snapshot.tokensSpent).toBeGreaterThan(0);
    expect(snapshot.stageStats.tokens).toBe(snapshot.tokensSpent);
    const secrets = spec.stages.flatMap((stage) => stage.agents.flatMap((agent) => [
      agent.privateContext.persona,
      agent.privateContext.motivations,
      agent.privateContext.hiddenInterests,
      agent.privateContext.knowledgeHorizon,
    ]));
    expect(auditClientPayload({ state: result.state }, secrets).ok).toBe(true);
  });

  it("finalizes a throwing mint client without panic or retrying the same batch", async () => {
    const store = new MemoryPlayStore([record("mint-throw")]);
    let calls = 0;
    const client: LlmClient = { complete: async () => { calls += 1; throw new Error("model unavailable"); } };
    const d: PlayServiceDeps = { store, llm: client };
    const afterMessages = await addPublicLines(d, store, "mint-throw");

    expect(afterMessages.ok, JSON.stringify(afterMessages)).toBe(true);
    if (!afterMessages.ok) return;
    expect(afterMessages.state.mintReady).toBe(true);
    expect(calls).toBe(0);
    const result = await postMintOptions(d, "mint-throw", STUDENT);

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.state.options.some((option) => option.id.startsWith("minted-"))).toBe(false);
    expect(result.state.mintReady).toBe(false);
    expect(store.saved.at(-1)?.snapshot.mintedAtSeq).toBe(6);
    expect(calls).toBe(1);
    expect((await postMintOptions(d, "mint-throw", STUDENT)).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("does not mint after a refused move", async () => {
    let now = Date.parse("2026-09-22T12:00:00.000Z");
    const session = PlaySession.start(spec, "mint-refused-move", 1, { now: () => new Date(now) });
    for (let index = 0; index < 6; index += 1) {
      const spoken = applyAction(session.world, { actorKind: "player", actorId: "player", action: { type: "speak", roomId: "landing-beach", body: `A public line ${index}.`, addresseeId: null } });
      expect(spoken.ok).toBe(true);
      now += 1000;
    }
    const before = session.snapshot();
    const client = new FakeLlmClient({ replies: [mintReply()] });
    const refused = await session.action(client, {
      type: "move_step",
      stageId: spec.stages[before.stageIndex]!.id,
      from: before.playerPos!,
      to: { x: before.playerPos!.x + 99, y: before.playerPos!.y + 99 },
    });

    expect(refused).toMatchObject({ ok: true, refused: expect.any(String) });
    expect(client.requests).toHaveLength(0);
    expect(session.snapshot().mintedAtSeq).toBe(before.mintedAtSeq);
  });
});
