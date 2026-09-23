import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, spaceAt, type Point } from "@adventure/game-core";
import { applyAction, FakeLlmClient, moveActorStep } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";

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

describe("authoritative spatial hearing", () => {
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

  it("does not count ambient speech, but counts an explicit causal reply", async () => {
    const session = PlaySession.start(spec, "hearing-objective", 1);
    const objective = spec.stages[0]!.objectives.find((candidate) => spec.stages[0]!.agents.some((agent) => agent.id === candidate.targetId));
    expect(objective).toBeDefined();
    const agentId = objective!.targetId;
    const agent = session.world.spatial!.state.actors[agentId]!;
    walk(session, PLAYER_ID, agent);
    const roomId = session.world.location[PLAYER_ID]!;
    expect(applyAction(session.world, { actorKind: "agent", actorId: agentId, action: { type: "speak", roomId, body: "Ambient line", addresseeId: PLAYER_ID } }).ok).toBe(true);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective!.id)!.met).toBe(false);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "I hear you.", actions: [] })] });
    const result = await session.message(llm, { roomId, body: "Please answer me.", addresseeId: agentId });
    expect(result.ok).toBe(true);
    expect(llm.requests).toHaveLength(1);
    const reply = session.world.transcript.find((line) => line.speakerId === agentId && line.body === "I hear you.");
    expect(reply?.replyToSeqs).toEqual([session.world.transcript.find((line) => line.speakerId === PLAYER_ID && line.body === "Please answer me.")!.seq]);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.find((candidate) => candidate.id === objective!.id)!.met).toBe(true);
  });

  it("rejects invalid addressees, broadcasts without a model call, and permits generic outdoors speech", async () => {
    const session = PlaySession.start(spec, "hearing-address", 1);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] });
    const roomId = session.world.location[PLAYER_ID]!;
    const invalid = await session.message(llm, { roomId, body: "Can you hear me?", addresseeId: "not-an-agent" });
    expect(invalid).toEqual({ ok: false, error: { code: "invalid_request", message: "That addressee cannot hear you." } });
    expect(llm.requests).toHaveLength(0);
    const broadcast = await session.message(llm, { roomId, body: "A broadcast." });
    expect(broadcast.ok).toBe(true);
    expect(llm.requests).toHaveLength(0);
    walk(session, PLAYER_ID, outdoorPoint(session));
    const outdoor = await session.message(llm, { roomId: "__outdoors__", body: "Outdoor broadcast." });
    expect(outdoor, JSON.stringify(outdoor)).toMatchObject({ ok: true });
    expect(llm.requests).toHaveLength(0);
  });
});
