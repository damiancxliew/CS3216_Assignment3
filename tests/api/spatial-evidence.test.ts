import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, isInPhysicalInteractionRange, spaceAt, type Point } from "@adventure/game-core";
import { applyAction, FakeLlmClient, moveActorStep } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";
import { compileStageMap } from "@/lib/play/layout";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;
beforeAll(async () => { spec = await loadI1Spec(); });

function outdoorPoint(session: PlaySession): Point {
  const map = session.world.spatial!.map;
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const point = { x, y };
    if (spaceAt(map, point)?.kind === "outdoor") return point;
  }
  throw new Error("fixture has no outdoor point");
}

function walk(session: PlaySession, actorId: string, target: Point) {
  const spatial = session.world.spatial!;
  const path = findPath(spatial.map, spatial.state.doors, spatial.state.actors[actorId]!, target);
  if (!path) throw new Error("fixture has no path");
  for (const point of path) expect(moveActorStep(session.world, actorId, point).ok).toBe(true);
}

describe("authoritative evidence interactions", () => {
  it("refuses far inspection and succeeds after walking within physical range", async () => {
    const session = PlaySession.start(spec, "evidence-range", 1);
    const evidence = spec.stages[0]!.evidence.find((item) => item.roomId === session.world.location.player) ?? spec.stages[0]!.evidence[0]!;
    const placement = compileStageMap(spec.stages[0]!, "evidence-range").placements.find((item) => item.id === evidence.id)!;
    for (const doorId of Object.keys(session.world.spatial!.state.doors)) session.world.spatial!.state.doors[doorId] = "open";
    for (const room of Object.values(session.world.rooms)) room.doorOpen = true;
    const room = session.world.spatial!.map.rooms.find((candidate) => candidate.id === evidence.roomId)!;
    const far = { x: room.x + room.width - 2, y: room.y + room.height - 2 };
    walk(session, "player", far);
    expect(isInPhysicalInteractionRange(session.world.spatial!.map, session.world.spatial!.state.doors, far, placement.position)).toBe(false);
    const refused = await session.action(new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] }), { type: "inspect", evidenceId: evidence.id });
    expect(refused).toEqual({ ok: true, refused: "Walk closer to examine that." });
    walk(session, "player", placement.position);
    const accepted = await session.action(new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] }), { type: "inspect", evidenceId: evidence.id });
    expect(accepted).toEqual({ ok: true, refused: null });
    expect(session.snapshot().journal).toHaveLength(1);
  });

  it("shares known evidence to nearby outdoor listeners only", () => {
    const session = PlaySession.start(spec, "evidence-share", 1);
    const world = session.world;
    const evidenceId = spec.stages[0]!.evidence[0]!.id;
    world.evidenceKnown.player = [evidenceId];
    walk(session, "player", outdoorPoint(session));
    const player = world.spatial!.state.actors.player!;
    const outdoor = Object.keys(world.actors).find((id) => id !== "player")!;
    const near = { x: player.x + 3, y: player.y };
    const far = { x: player.x + 4, y: player.y };
    expect(spaceAt(world.spatial!.map, near)?.kind).toBe("outdoor");
    expect(spaceAt(world.spatial!.map, far)?.kind).toBe("outdoor");
    world.spatial!.state.actors[outdoor] = near;
    world.location[outdoor] = "__outdoors__";
    const shared = applyAction(world, { actorKind: "player", actorId: "player", action: { type: "share_evidence", roomId: "__outdoors__", evidenceId } });
    expect(shared, JSON.stringify(shared)).toMatchObject({ ok: true });
    expect(world.evidenceKnown[outdoor]).toContain(evidenceId);
    world.evidenceKnown[outdoor] = [];
    world.spatial!.state.actors[outdoor] = far;
    applyAction(world, { actorKind: "player", actorId: "player", action: { type: "share_evidence", roomId: "__outdoors__", evidenceId } });
    expect(world.evidenceKnown[outdoor] ?? []).not.toContain(evidenceId);
  });

  it("syncs an NPC evidence share into the player journal once and refuses unknown evidence", async () => {
    const session = PlaySession.start(spec, "evidence-journal", 1);
    const world = session.world;
    const evidenceId = spec.stages[0]!.evidence[0]!.id;
    const agentId = spec.stages[0]!.agents[0]!.id;
    world.evidenceKnown[agentId] = [evidenceId];
    world.spatial!.state.actors[agentId] = world.spatial!.state.actors.player!;
    world.location[agentId] = world.location.player!;
    const roomId = world.location.player!;
    const shared = applyAction(world, { actorKind: "agent", actorId: agentId, action: { type: "share_evidence", roomId, evidenceId } });
    expect(shared, JSON.stringify(shared)).toMatchObject({ ok: true });
    const player = world.spatial!.state.actors.player!;
    const target = { x: player.x + 1, y: player.y };
    const result = await session.action(new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] }), { type: "move_step", stageId: spec.stages[0]!.id, from: player, to: target });
    expect(result.ok).toBe(true);
    expect(session.snapshot().journal.filter((entry) => entry.id === evidenceId)).toHaveLength(1);
    const unknown = await session.action(new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] }), { type: "share_evidence", evidenceId: "unknown-evidence" });
    expect(unknown).toMatchObject({ ok: true, refused: expect.any(String) });
  });
});
