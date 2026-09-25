import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, spaceAt, type Point } from "@adventure/game-core";
import { applyAction, hasConversationExchange, moveActorStep, type LlmClient, type LlmResponse } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;
beforeAll(async () => { spec = await loadI1Spec(); });

function walk(session: PlaySession, actorId: string, target: Point) {
  const spatial = session.world.spatial!;
  const path = findPath(spatial.map, spatial.state.doors, spatial.state.actors[actorId]!, target);
  if (!path) throw new Error("fixture has no path");
  for (const point of path) expect(moveActorStep(session.world, actorId, point).ok).toBe(true);
}

function colocateWithAgent(session: PlaySession) {
  const agentId = spec.stages[0]!.agents.find((agent) => {
    const agentPoint = session.world.spatial!.state.actors[agent.id];
    return agentPoint && findPath(session.world.spatial!.map, session.world.spatial!.state.doors, session.world.spatial!.state.actors.player!, agentPoint) !== null;
  })!.id;
  const target = session.world.spatial!.state.actors[agentId]!;
  walk(session, "player", target);
  return { agentId, roomId: session.world.location.player! };
}

describe("session dialogue phases", () => {
  it("routes room speech to two present characters and records both causal replies", async () => {
    const session = PlaySession.start(spec, "room-replies", 1);
    const { agentId, roomId } = colocateWithAgent(session);
    const secondId = spec.stages[0]!.agents.find((agent) => agent.id !== agentId)!.id;
    session.world.spatial!.state.actors[secondId] = { ...session.world.spatial!.state.actors[agentId]! };
    session.world.location[secondId] = roomId;
    const requests: string[] = [];
    const llm: LlmClient = { complete: async (request): Promise<LlmResponse> => {
      requests.push(request.schemaName);
      const content = request.schemaName === "room_reply_route"
        ? JSON.stringify({ agentIds: [secondId, agentId] })
        : JSON.stringify({ say: `Reply ${requests.length - 1}`, actions: [] });
      return { content, usage: { promptTokens: 1, completionTokens: 1 } };
    } };
    const result = await session.message(llm, { roomId, body: "What do you both think?" });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(3);
    expect(requests[0]).toBe("room_reply_route");
    const source = session.world.transcript.find((line) => line.body === "What do you both think?")!;
    expect(source.addresseeId).toBeNull();
    expect(source.recipientIds).toEqual(expect.arrayContaining([agentId, secondId]));
    const replies = session.world.transcript.filter((line) => line.replyToSeqs?.includes(source.seq));
    expect(replies.map((line) => line.speakerId)).toEqual([secondId, agentId]);
    expect(hasConversationExchange(session.world, "player", agentId)).toBe(true);
    expect(hasConversationExchange(session.world, "player", secondId)).toBe(true);
  });

  it("does not let a direct reply send the addressed NPC walking away", async () => {
    const session = PlaySession.start(spec, "dialogue-stay-put", 1);
    const { agentId, roomId } = colocateWithAgent(session);
    const destination = spec.stages[0]!.rooms.find((room) => room.id !== roomId)!.id;
    const position = { ...session.world.spatial!.state.actors[agentId]! };
    const llm = { complete: async (): Promise<LlmResponse> => ({ content: JSON.stringify({ say: "I hear you.", actions: [{ type: "move_room", toRoomId: destination }] }), usage: { promptTokens: 1, completionTokens: 1 } }) } satisfies LlmClient;
    expect((await session.message(llm, { roomId, body: "Please stay and talk.", addresseeId: agentId })).ok).toBe(true);
    expect(session.world.spatial!.targets[agentId]).toBeUndefined();
    expect(session.world.spatial!.state.actors[agentId]).toEqual(position);
  });

  it("begins, produces, and completes a causal reply while blocking a second addressed request", async () => {
    const session = PlaySession.start(spec, "dialogue-session", 1);
    const { agentId, roomId } = colocateWithAgent(session);
    const llm = { complete: async (): Promise<LlmResponse> => ({ content: JSON.stringify({ say: "I hear you.", actions: [] }), usage: { promptTokens: 1, completionTokens: 1 } }) } satisfies LlmClient;
    const begun = session.beginMessage({ roomId, body: "Please answer me.", addresseeId: agentId });
    expect(begun.ok).toBe(true);
    if (!begun.ok || !begun.ticket) return;
    expect(session.snapshot().pendingReply?.id).toBe(begun.ticket.id);
    const broadcast = session.beginMessage({ roomId, body: "An ambient broadcast." });
    expect(broadcast).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(session.snapshot().pendingReply?.id).toBe(begun.ticket.id);
    const reply = await session.produceReply(llm, begun.ticket);
    const completed = session.completeReply(begun.ticket, reply);
    expect(completed.ok).toBe(true);
    expect(session.snapshot().pendingReply).toBeNull();
    expect(hasConversationExchange(session.world, "player", agentId)).toBe(true);
    const causal = session.world.transcript.find((line) => line.speakerId === agentId && line.body === "I hear you.");
    expect(causal?.replyToSeqs).toEqual([begun.ticket.utteranceSeq]);
  });

  it("keeps movement while deferred reply production is pending and accepts a late reply", async () => {
    let now = Date.now();
    const session = PlaySession.start(spec, "dialogue-deferred", 1, { now: () => new Date(now) });
    const { agentId, roomId } = colocateWithAgent(session);
    let release!: (response: LlmResponse) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const llm: LlmClient = { complete: async () => { started(); return new Promise<LlmResponse>((resolve) => { release = resolve; }); } };
    const begun = session.beginMessage({ roomId, body: "Wait for my answer.", addresseeId: agentId });
    expect(begun.ok).toBe(true);
    if (!begun.ok || !begun.ticket) return;
    const producing = session.produceReply(llm, begun.ticket);
    await startedPromise;
    const player = session.world.spatial!.state.actors.player!;
    const outdoor = (() => {
      for (let y = 0; y < session.world.spatial!.map.height; y += 1) for (let x = 0; x < session.world.spatial!.map.width; x += 1) if (spaceAt(session.world.spatial!.map, { x, y })?.kind === "outdoor") return { x, y };
      throw new Error("fixture has no outdoor point");
    })();
    walk(session, "player", outdoor);
    const moved = session.world.spatial!.state.actors.player!;
    release({ content: JSON.stringify({ say: "A delayed answer.", actions: [] }), usage: { promptTokens: 1, completionTokens: 1 } });
    const reply = await producing;
    const completed = session.completeReply(begun.ticket, reply);
    expect(completed.ok).toBe(true);
    expect(session.world.spatial!.state.actors.player).toEqual(moved);
    expect(completed.ok && completed.newMessages.some((message) => message.body === "A delayed answer.")).toBe(false);
    expect(session.state({ enabled: false, deadlineAt: null }).stage.objectives.some((objective) => objective.met)).toBe(false);
    now = begun.ticket.expiresAt + 1;
    expect(session.completeReply(begun.ticket, reply)).toEqual({ ok: true, newMessages: [] });
  });
});
