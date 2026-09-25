import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, spaceAt, type Point } from "@adventure/game-core";
import { applyAction, FakeLlmClient, hasConversationExchange, moveActorStep } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";
import { withGoalJudge } from "./goal-judge";

/** Speak, then run the independent goal check the play client triggers once the reply lands. */
async function talk(session: PlaySession, llm: FakeLlmClient, input: Parameters<PlaySession["message"]>[1]) {
  const result = await session.message(llm, input);
  await session.checkGoals(withGoalJudge(llm));
  return result;
}

const PLAYER_ID = "player";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => {
  spec = await loadI1Spec();
});

function walk(session: PlaySession, actorId: string, target: Point) {
  const spatial = session.world.spatial!;
  const from = spatial.state.actors[actorId]!;
  const path = findPath(spatial.map, spatial.state.doors, from, target);
  if (!path) throw new Error(`no path to ${target.x},${target.y}`);
  for (const point of path) expect(moveActorStep(session.world, actorId, point).ok).toBe(true);
}

function outdoorPoint(session: PlaySession): Point {
  const map = session.world.spatial!.map;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const point = { x, y };
      if (spaceAt(map, point)?.kind === "outdoor" && session.world.spatial!.state.actors[PLAYER_ID]!.x !== x) return point;
    }
  }
  throw new Error("fixture has no outdoor point");
}

function goalFixture() {
  const goalSpec = structuredClone(spec);
  const stage = goalSpec.stages[0]!;
  const objective = stage.objectives.find((candidate) => (
    candidate.requires.length === 0 && stage.agents.some((agent) => agent.id === candidate.targetId)
  ))!;
  stage.decision.requires = [objective.id];
  stage.decision.options.find((option) => option.id === "opt-sign-preliminary")!.preconditions = [objective.id];
  return { goalSpec, objective };
}

function sessionForGoal(attemptId: string, goal = goalFixture()) {
  let now = Date.now();
  const session = PlaySession.start(goal.goalSpec, attemptId, 1, { now: () => new Date(now) });
  const agentId = goal.objective.targetId;
  walk(session, PLAYER_ID, session.world.spatial!.state.actors[agentId]!);
  return { ...goal, session, agentId, roomId: session.world.location[PLAYER_ID]!, advance: () => { now += 2_000; } };
}

function claimedReply(say: string, objectiveIds: readonly string[]): string {
  return JSON.stringify({
    say,
    actions: objectiveIds.map((objectiveId) => ({ type: "goal_evidence", objectiveId, quote: say })),
  });
}

describe("authoritative spatial hearing", () => {
  it("credits a routed room reply to the objective of the NPC who answered", async () => {
    const goal = goalFixture();
    const { session, agentId, roomId } = sessionForGoal("hearing-routed-objective", goal);
    const say = "The river mouth could support the post.";
    const llm = new FakeLlmClient({ replies: [
      (request) => request.schemaName === "room_reply_route"
        ? JSON.stringify({ agentIds: [agentId] })
        : claimedReply(say, [goal.objective.id]),
    ] });
    const opening = await talk(session, llm, { roomId, body: "What makes you think the river mouth would work?" });
    expect(opening.ok).toBe(true);
    const line = session.world.transcript.findLast((candidate) => candidate.speakerId === agentId && candidate.body === say);
    expect(line?.goalIds).toEqual([goal.objective.id]);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === goal.objective.id)?.met).toBe(true);
  });

  it("omits a four-tile outdoor line permanently until a new near line is spoken", () => {
    const session = PlaySession.start(spec, "hearing-outdoors", 1);
    const outdoor = outdoorPoint(session);
    walk(session, PLAYER_ID, outdoor);
    const agentId = spec.stages[0]!.agents[0]!.id;
    const player = session.world.spatial!.state.actors[PLAYER_ID]!;
    const far = (() => {
      for (let y = 0; y < session.world.spatial!.map.height; y += 1) for (let x = 0; x < session.world.spatial!.map.width; x += 1) {
        const candidate = { x, y };
        if (spaceAt(session.world.spatial!.map, candidate)?.kind !== "outdoor") continue;
        const path = findPath(session.world.spatial!.map, session.world.spatial!.state.doors, player, candidate);
        if (path && path.length >= 4) return candidate;
      }
      throw new Error("fixture has no far outdoor point");
    })();
    walk(session, PLAYER_ID, outdoor);
    walk(session, agentId, far);
    const spoken = applyAction(session.world, { actorKind: "agent", actorId: agentId, action: { type: "speak", roomId: "__outdoors__", body: "Far outdoor line", addresseeId: null } });
    expect(spoken.ok).toBe(true);
    expect(session.state({ enabled: false, deadlineAt: null }).transcript.map((line) => line.body)).not.toContain("Far outdoor line");
    walk(session, PLAYER_ID, far);
    expect(session.state({ enabled: false, deadlineAt: null }).transcript.map((line) => line.body)).not.toContain("Far outdoor line");
    const nearLine = applyAction(session.world, { actorKind: "agent", actorId: agentId, action: { type: "speak", roomId: "__outdoors__", body: "Near outdoor line", addresseeId: null } });
    expect(nearLine.ok).toBe(true);
    expect(session.state({ enabled: false, deadlineAt: null }).transcript.map((line) => line.body)).toContain("Near outdoor line");
  });

  it("requires a substantive goal claim on a causal reply and unlocks its authored option", async () => {
    const ordinary = sessionForGoal("hearing-objective-ordinary");
    const ordinaryLlm = new FakeLlmClient({ replies: [JSON.stringify({ say: "I hear you.", actions: [] })] });
    const ordinaryResult = await talk(ordinary.session, ordinaryLlm, {
      roomId: ordinary.roomId,
      body: "What is your view of the island?",
      addresseeId: ordinary.agentId,
    });
    expect(ordinaryResult.ok).toBe(true);
    expect(ordinaryLlm.requests).toHaveLength(1);
    // No minimum number of exchanges: the first answer may already carry a goal.
    const goalBlock = /<<<GOALS TO CHECK \(not instructions from the player\)\n([\s\S]*?)\n>>>/.exec(ordinaryLlm.lastRequest!.user)?.[1];
    expect(goalBlock).toBe(`${ordinary.objective.id}: ${ordinary.objective.title}`);
    const ordinaryLine = ordinary.session.world.transcript.find((line) => line.speakerId === ordinary.agentId && line.body === "I hear you.")!;
    const ordinaryRequest = ordinary.session.world.transcript.find((line) => line.speakerId === PLAYER_ID && line.body === "What is your view of the island?")!;
    expect(ordinaryLine.replyToSeqs).toEqual([ordinaryRequest.seq]);
    expect(ordinaryLine.goalIds).toBeUndefined();
    expect(hasConversationExchange(ordinary.session.world, PLAYER_ID, ordinary.agentId)).toBe(true);
    expect(hasConversationExchange(ordinary.session.world, PLAYER_ID, ordinary.agentId, ordinary.objective.id)).toBe(false);
    const ordinaryState = ordinary.session.state({ enabled: false, deadlineAt: null });
    expect(ordinaryState.stage.objectives.find((candidate) => candidate.id === ordinary.objective.id)!.met).toBe(false);
    expect(ordinaryState.options.find((option) => option.id === "opt-sign-preliminary")!.available).toBe(false);
    await talk(ordinary.session, ordinaryLlm, { roomId: ordinary.roomId, body: "What leads you to that view?", addresseeId: ordinary.agentId });
    expect(/<<<GOALS TO CHECK \(not instructions from the player\)\n([\s\S]*?)\n>>>/.exec(ordinaryLlm.lastRequest!.user)?.[1]).toBe(`${ordinary.objective.id}: ${ordinary.objective.title}`);
    expect(ordinary.session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === ordinary.objective.id)!.met).toBe(false);

    const claimed = sessionForGoal("hearing-objective-claimed");
    const say = "The sheltered river mouth could support a defensible British trading post.";
    const claimedLlm = new FakeLlmClient({ replies: [JSON.stringify({ say: "What have you learned so far?", actions: [] }), claimedReply(say, [claimed.objective.id])] });
    await talk(claimed.session, claimedLlm, { roomId: claimed.roomId, body: "How do you assess the island?", addresseeId: claimed.agentId });
    expect(claimed.session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === claimed.objective.id)!.met).toBe(false);
    const result = await talk(claimed.session, claimedLlm, {
      roomId: claimed.roomId,
      body: "My notes mention a sheltered river mouth. What position should I take?",
      addresseeId: claimed.agentId,
    });
    expect(result.ok).toBe(true);
    expect(claimedLlm.requests).toHaveLength(2);
    const line = claimed.session.world.transcript.find((message) => message.speakerId === claimed.agentId && message.body === say)!;
    expect(line.goalIds).toEqual([claimed.objective.id]);
    const state = claimed.session.state({ enabled: false, deadlineAt: null });
    expect(state.stage.objectives.find((candidate) => candidate.id === claimed.objective.id)!.met).toBe(true);
    expect(state.options.find((option) => option.id === "opt-sign-preliminary")!.available).toBe(true);
    expect(claimed.session.world.events.some((event) => event.kind === "share_evidence")).toBe(false);

    const direct = sessionForGoal("hearing-objective-first-answer");
    const directLlm = new FakeLlmClient({ replies: [claimedReply(say, [direct.objective.id])] });
    await talk(direct.session, directLlm, { roomId: direct.roomId, body: "How do you assess the river mouth?", addresseeId: direct.agentId });
    expect(direct.session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === direct.objective.id)!.met).toBe(true);
  });

  it("does not count ambient speech without a linked addressed request", () => {
    const { session, objective, agentId, roomId } = sessionForGoal("hearing-objective-ambient");
    expect(applyAction(session.world, { actorKind: "agent", actorId: agentId, action: { type: "speak", roomId, body: "The river mouth can support trade.", addresseeId: PLAYER_ID } }).ok).toBe(true);
    expect(hasConversationExchange(session.world, PLAYER_ID, agentId)).toBe(false);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective.id)!.met).toBe(false);
  });

  it("rejects a goal claim whose quote does not exactly match the spoken line", async () => {
    const { session, objective, agentId, roomId } = sessionForGoal("hearing-objective-wrong-quote");
    await talk(session, new FakeLlmClient({ replies: [JSON.stringify({ say: "What do you already know?", actions: [] })] }), { roomId, body: "Tell me about the river mouth.", addresseeId: agentId });
    const say = "The sheltered river mouth could support a British trading post.";
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say, actions: [{ type: "goal_evidence", objectiveId: objective.id, quote: "The river mouth could support a British trading post." }] })] });
    await talk(session, llm, { roomId, body: "What is your view?", addresseeId: agentId });
    const line = session.world.transcript.find((message) => message.speakerId === agentId && message.body === say)!;
    expect(line.goalIds).toBeUndefined();
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective.id)!.met).toBe(false);
  });

  it("marks a claimed goal only after the independent check agrees", async () => {
    const say = "The sheltered river mouth could support a British trading post.";
    const met = (session: PlaySession, id: string) => session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === id)!.met;

    const accepted = sessionForGoal("goal-check-accepted");
    await accepted.session.message(new FakeLlmClient({ replies: [claimedReply(say, [accepted.objective.id])] }), { roomId: accepted.roomId, body: "How do you assess the river mouth?", addresseeId: accepted.agentId });
    expect(met(accepted.session, accepted.objective.id)).toBe(false);
    expect(accepted.session.state({ enabled: false, deadlineAt: null }).goalCheckReady).toBe(true);
    const judge = withGoalJudge(new FakeLlmClient({ replies: ["{}"] }));
    await accepted.session.checkGoals(judge);
    expect(judge.judged).toBe(1);
    expect(met(accepted.session, accepted.objective.id)).toBe(true);
    expect(accepted.session.state({ enabled: false, deadlineAt: null }).goalCheckReady).toBe(false);

    const rejected = sessionForGoal("goal-check-rejected");
    await rejected.session.message(new FakeLlmClient({ replies: [claimedReply("Welcome, welcome. Sit down.", [rejected.objective.id])] }), { roomId: rejected.roomId, body: "Hello!", addresseeId: rejected.agentId });
    await rejected.session.checkGoals(withGoalJudge(new FakeLlmClient({ replies: ["{}"] }), () => false));
    expect(met(rejected.session, rejected.objective.id)).toBe(false);
    expect(rejected.session.state({ enabled: false, deadlineAt: null }).goalCheckReady).toBe(false);

    const failing = sessionForGoal("goal-check-failing");
    await failing.session.message(new FakeLlmClient({ replies: [claimedReply(say, [failing.objective.id])] }), { roomId: failing.roomId, body: "How do you assess the river mouth?", addresseeId: failing.agentId });
    const broken = new FakeLlmClient({ replies: ["not json"] });
    await failing.session.checkGoals(broken);
    expect(failing.session.state({ enabled: false, deadlineAt: null }).goalCheckReady).toBe(true);
    await failing.session.checkGoals(broken);
    expect(failing.session.state({ enabled: false, deadlineAt: null }).goalCheckReady).toBe(false);
    expect(met(failing.session, failing.objective.id)).toBe(false);
  });

  it("rejects a claim for another agent's objective", async () => {
    const { session, goalSpec, objective, agentId, roomId } = sessionForGoal("hearing-objective-wrong-agent");
    await talk(session, new FakeLlmClient({ replies: [JSON.stringify({ say: "What is your interest here?", actions: [] })] }), { roomId, body: "Tell me about the river mouth.", addresseeId: agentId });
    const other = goalSpec.stages[0]!.objectives.find((candidate) => candidate.targetId !== agentId && goalSpec.stages[0]!.agents.some((agent) => agent.id === candidate.targetId))!;
    const say = "The sheltered river mouth could support a British trading post.";
    const llm = new FakeLlmClient({ replies: [claimedReply(say, [other.id])] });
    await talk(session, llm, { roomId, body: "What is your view?", addresseeId: agentId });
    const line = session.world.transcript.find((message) => message.speakerId === agentId && message.body === say)!;
    expect(line.goalIds).toBeUndefined();
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective.id)!.met).toBe(false);
  });

  it("never credits a deflection", async () => {
    const { session, objective, agentId, roomId } = sessionForGoal("hearing-objective-deflection");
    const llm = new FakeLlmClient({ replies: ["not-json"] });
    await talk(session, llm, { roomId, body: "What is your view?", addresseeId: agentId });
    expect(llm.requests).toHaveLength(3);
    const line = session.world.transcript.find((message) => message.speakerId === agentId)!;
    expect(line.replyToSeqs).toBeUndefined();
    expect(line.goalIds).toBeUndefined();
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective.id)!.met).toBe(false);
  });

  it("does not credit a claimed line the player could not hear", async () => {
    const { session, objective, agentId, roomId } = sessionForGoal("hearing-objective-not-heard");
    await talk(session, new FakeLlmClient({ replies: [JSON.stringify({ say: "What is your proposal?", actions: [] })] }), { roomId, body: "Can we discuss the island?", addresseeId: agentId });
    const body = "What position should the Company take?";
    const begun = session.beginMessage({ roomId, body, addresseeId: agentId });
    expect(begun.ok).toBe(true);
    if (!begun.ok || !begun.ticket) return;
    const say = "The sheltered river mouth could support a British trading post.";
    const llm = new FakeLlmClient({ replies: [claimedReply(say, [objective.id])] });
    const producing = session.produceReply(llm, begun.ticket);
    const spatial = session.world.spatial!;
    const agentPoint = spatial.state.actors[agentId]!;
    const far = (() => {
      for (let y = 0; y < spatial.map.height; y += 1) for (let x = 0; x < spatial.map.width; x += 1) {
        const candidate = { x, y };
        if (spaceAt(spatial.map, candidate)?.kind !== "outdoor") continue;
        const path = findPath(spatial.map, spatial.state.doors, agentPoint, candidate);
        if (path && path.length >= 4) return candidate;
      }
      throw new Error("fixture has no far outdoor point");
    })();
    walk(session, PLAYER_ID, far);
    const reply = await producing;
    session.completeReply(begun.ticket, reply);
    const line = session.world.transcript.find((message) => message.speakerId === agentId && message.body === say)!;
    expect(line.replyToSeqs).toEqual([begun.ticket.utteranceSeq]);
    expect(line.recipientIds).not.toContain(PLAYER_ID);
    expect(line.goalIds).toBeUndefined();
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective.id)!.met).toBe(false);
  });

  it("supports multiple goals for one agent and preserves credited lines on resume", async () => {
    const goal = goalFixture();
    const stage = goal.goalSpec.stages[0]!;
    const secondId = "obj-farquhar-position-detail";
    stage.objectives.push({ id: secondId, title: "Hear Farquhar's view of a trading post", requires: [], targetId: goal.objective.targetId });
    stage.decision.requires = [goal.objective.id, secondId];
    stage.decision.options.find((option) => option.id === "opt-sign-preliminary")!.preconditions = [goal.objective.id, secondId];
    const { session, agentId, roomId } = sessionForGoal("hearing-objective-multiple", goal);
    const say = "A sheltered river mouth would be useful for a British trading post.";
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "Tell me what you have heard.", actions: [] }), claimedReply(say, [goal.objective.id, secondId])] });
    await talk(session, llm, { roomId, body: "What do you think of the river mouth?", addresseeId: agentId });
    await talk(session, llm, { roomId, body: "And what makes it useful for trade?", addresseeId: agentId });
    const line = session.world.transcript.find((message) => message.speakerId === agentId && message.body === say)!;
    expect(line.goalIds).toEqual([goal.objective.id, secondId]);
    expect(llm.requests).toHaveLength(2);
    const state = session.state({ enabled: false, deadlineAt: null });
    expect(state.stage.objectives.find((candidate) => candidate.id === goal.objective.id)!.met).toBe(true);
    expect(state.stage.objectives.find((candidate) => candidate.id === secondId)!.met).toBe(true);
    expect(state.options.find((option) => option.id === "opt-sign-preliminary")!.available).toBe(true);

    const resumed = PlaySession.resume(goal.goalSpec, "hearing-objective-multiple", 1, session.snapshot());
    expect(resumed.world.transcript.find((candidate) => candidate.seq === line.seq)?.goalIds).toEqual([goal.objective.id, secondId]);
    const resumedState = resumed.state({ enabled: false, deadlineAt: null });
    expect(resumedState.stage.objectives.find((candidate) => candidate.id === goal.objective.id)!.met).toBe(true);
    expect(resumedState.stage.objectives.find((candidate) => candidate.id === secondId)!.met).toBe(true);
    expect(resumedState.transcript.every((message) => !("goalIds" in message))).toBe(true);
  });

  it("keeps a dependent conversation goal locked until its prerequisite has been met", async () => {
    const goal = goalFixture();
    const stage = goal.goalSpec.stages[0]!;
    const dependentId = "obj-farquhar-detail-after-assessment";
    stage.objectives.push({ id: dependentId, title: "Hear Farquhar's detail after his assessment", requires: [goal.objective.id], targetId: goal.objective.targetId });
    stage.decision.requires = [goal.objective.id, dependentId];
    stage.decision.options.find((option) => option.id === "opt-sign-preliminary")!.preconditions = [goal.objective.id, dependentId];
    const { session, agentId, roomId, advance } = sessionForGoal("hearing-objective-retroactive", goal);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === dependentId)).toMatchObject({
      met: false,
      requires: [goal.objective.id],
    });
    const firstSay = "The harbor could serve the Company's trade.";
    const secondSay = "A sheltered river mouth would be useful for a British trading post.";
    const thirdSay = "That sheltered approach would also protect small craft.";
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "What have you seen?", actions: [] }), claimedReply(firstSay, [dependentId]), claimedReply(secondSay, [goal.objective.id]), claimedReply(thirdSay, [dependentId])] });
    await talk(session, llm, { roomId, body: "What do you think of the river mouth?", addresseeId: agentId });
    advance();
    await talk(session, llm, { roomId, body: "What else matters?", addresseeId: agentId });
    expect(session.world.transcript.find((message) => message.speakerId === agentId && message.body === firstSay)?.goalIds).toBeUndefined();
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === dependentId)!.met).toBe(false);

    advance();
    await talk(session, llm, { roomId, body: "And what about a permanent post?", addresseeId: agentId });
    expect(session.world.transcript.find((message) => message.speakerId === agentId && message.body === secondSay)?.goalIds).toEqual([goal.objective.id]);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === dependentId)!.met).toBe(false);
    advance();
    await talk(session, llm, { roomId, body: "How would that approach protect the post?", addresseeId: agentId });
    const state = session.state({ enabled: false, deadlineAt: null });
    expect(state.stage.objectives.find((candidate) => candidate.id === goal.objective.id)!.met).toBe(true);
    expect(state.stage.objectives.find((candidate) => candidate.id === dependentId)!.met).toBe(true);
  });

  it("rejects invalid addressees, broadcasts without a model call, and permits generic outdoors speech", async () => {
    const session = PlaySession.start(spec, "hearing-address", 1);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] });
    const roomId = session.world.location[PLAYER_ID]!;
    const invalid = await talk(session, llm, { roomId, body: "Can you hear me?", addresseeId: "not-an-agent" });
    expect(invalid).toEqual({ ok: false, error: { code: "invalid_request", message: "That addressee cannot hear you." } });
    expect(llm.requests).toHaveLength(0);
    const broadcast = await talk(session, llm, { roomId, body: "A broadcast." });
    expect(broadcast.ok).toBe(true);
    expect(llm.requests).toHaveLength(0);
    walk(session, PLAYER_ID, outdoorPoint(session));
    const outdoor = await talk(session, llm, { roomId: "__outdoors__", body: "Outdoor broadcast." });
    expect(outdoor, JSON.stringify(outdoor)).toMatchObject({ ok: true });
    expect(llm.requests).toHaveLength(0);
  });
});
