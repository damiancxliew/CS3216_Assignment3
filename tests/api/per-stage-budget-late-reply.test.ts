import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath } from "@adventure/game-core";
import { FakeLlmClient, moveActorStep } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { postMessage, type PlayServiceDeps } from "@/lib/play/service";
import { PlaySession } from "@/lib/play/session";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";

const ATTEMPT_ID = "per-stage-budget-late-reply";
const STUDENT_ID = "per-stage-budget-student";
const STAGE_TOKEN_BUDGET = 60_000;

let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => {
  spec = await loadI1Spec();
});

function positionedSession(attemptId: string): { session: PlaySession; agentId: string; roomId: string } {
  const session = PlaySession.start(spec, attemptId, 1);
  const stage = spec.stages[0]!;
  const agentId = stage.objectives.find((objective) => (
    objective.requires.length === 0 &&
    stage.agents.some((agent) => agent.id === objective.targetId)
  ))!.targetId;
  const player = session.world.spatial!.state.actors.player!;
  const agent = session.world.spatial!.state.actors[agentId]!;
  const path = findPath(session.world.spatial!.map, session.world.spatial!.state.doors, player, agent);
  if (!path) throw new Error("fixture has no path to objective agent");
  for (const point of path) expect(moveActorStep(session.world, "player", point).ok).toBe(true);
  return { session, agentId, roomId: session.world.location.player! };
}

function record(session: PlaySession, attemptId: string): AttemptRecord {
  return {
    attemptId,
    studentId: STUDENT_ID,
    adventureId: spec.id,
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec,
    snapshot: session.snapshot(),
    runtimeRevision: 0,
  };
}

function stageObjective() {
  const stage = spec.stages[0]!;
  return stage.objectives.find((objective) => (
    objective.requires.length === 0 &&
    stage.agents.some((agent) => agent.id === objective.targetId)
  ))!;
}

describe("per-stage budgets and late replies", () => {
  it("lands a reply produced after the ticket expiry and credits its objective", async () => {
    const initial = positionedSession("late-reply");
    let now = Date.parse("2026-09-22T12:00:00.000Z");
    const store = new MemoryPlayStore([record(initial.session, "late-reply")]);
    store.clock = () => new Date(now);
    const llm = new FakeLlmClient({
      replies: [() => {
        now += 180_000;
        store.clock = () => new Date(now);
        return JSON.stringify({ say: "A delayed answer.", actions: [] });
      }],
    });
    const deps: PlayServiceDeps = { store, llm };

    const result = await postMessage(deps, "late-reply", STUDENT_ID, {
      roomId: initial.roomId,
      body: "Please answer me.",
      addresseeId: initial.agentId,
    });

    expect(result.ok).toBe(true);
    const snapshot = (await store.load("late-reply", STUDENT_ID))!.snapshot!;
    const playerLine = snapshot.world.transcript.find((line) => line.speakerId === "player" && line.body === "Please answer me.");
    const reply = snapshot.world.transcript.find((line) => line.speakerId === initial.agentId && line.body === "A delayed answer.");
    expect(reply).toBeDefined();
    expect(reply?.replyToSeqs).toEqual([playerLine?.seq]);
    expect(snapshot.world.transcript).toContainEqual(expect.objectContaining({ body: "A delayed answer." }));
    expect(result.ok && result.state.stage.objectives.find((objective) => objective.id === stageObjective().id)?.met).toBe(true);
  });

  it("announces when a superseded ticket is refused without a live replacement", () => {
    const initial = positionedSession("stale-ticket");
    const begun = initial.session.beginMessage({
      roomId: initial.roomId,
      body: "Please answer me.",
      addresseeId: initial.agentId,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok || !begun.ticket) return;
    const snapshot = initial.session.snapshot();
    snapshot.pendingReply = null;
    const resumed = PlaySession.resume(spec, "stale-ticket", 1, snapshot);

    const result = resumed.completeReply({ ...begun.ticket, id: "superseded-ticket" }, null);

    expect(result).toEqual({ ok: true, newMessages: [] });
    expect(resumed.world.transcript.filter((line) => line.speakerId === initial.agentId)).toHaveLength(0);
    expect(resumed.snapshot().announcements.at(-1)?.body).toBe("The reply was interrupted. Please try again.");
  });

  it("uses stage token spend rather than attempt spend for addressed replies", async () => {
    const initial = positionedSession("stage-budget-available");
    const snapshot = initial.session.snapshot();
    snapshot.tokensSpent = STAGE_TOKEN_BUDGET + 1;
    snapshot.stageStats.tokens = 0;
    const resumed = PlaySession.resume(spec, "stage-budget-available", 1, snapshot);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "A real answer.", actions: [] })] });

    const result = await resumed.message(llm, {
      roomId: initial.roomId,
      body: "Please answer me.",
      addresseeId: initial.agentId,
    });

    expect(result.ok).toBe(true);
    expect(llm.requests).toHaveLength(1);
    const playerLine = resumed.world.transcript.find((line) => line.speakerId === "player" && line.body === "Please answer me.");
    expect(resumed.world.transcript.find((line) => line.body === "A real answer.")?.replyToSeqs).toEqual([playerLine?.seq]);
  });

  it("still deflects when the current stage has exhausted its budget", async () => {
    const initial = positionedSession("stage-budget-exhausted");
    const snapshot = initial.session.snapshot();
    snapshot.tokensSpent = 0;
    snapshot.stageStats.tokens = STAGE_TOKEN_BUDGET;
    const resumed = PlaySession.resume(spec, "stage-budget-exhausted", 1, snapshot);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "Should not be called.", actions: [] })] });

    const result = await resumed.message(llm, {
      roomId: initial.roomId,
      body: "Please answer me.",
      addresseeId: initial.agentId,
    });

    expect(result.ok).toBe(true);
    expect(llm.requests).toHaveLength(0);
    expect(resumed.world.transcript.some((line) => line.speakerId === initial.agentId && line.replyToSeqs === undefined)).toBe(true);
  });
});
