import { loadI1Spec } from "@adventure/generation/fixtures";
import { findPath, isWalkable, type Point } from "@adventure/game-core";
import { FakeLlmClient, moveActorStep } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => {
  spec = await loadI1Spec();
});

function clock() {
  let milliseconds = Date.parse("2026-09-22T12:00:00.000Z");
  return { now: () => new Date(milliseconds), advance: (amount: number) => { milliseconds += amount; } };
}

function adjacent(map: Parameters<typeof isWalkable>[0], doors: Parameters<typeof isWalkable>[1], from: Point): Point {
  const candidates = [{ x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y }, { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 }];
  const found = candidates.find((point) => isWalkable(map, doors, point));
  if (!found) throw new Error("fixture player has no adjacent walkable tile");
  return found;
}

describe("authoritative spatial movement", () => {
  it("moves one adjacent tile, advances a targeted NPC, and never calls the model", async () => {
    const timer = clock();
    const session = PlaySession.start(spec, "movement-success", 1, timer);
    const llm = new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] });
    const world = session.world;
    const agentId = spec.stages[0]!.agents[0]!.id;
    const targetRoom = spec.stages[0]!.rooms.find((room) => room.id !== world.location[agentId])!.id;
    world.spatial!.targets[agentId] = targetRoom;
    const beforePlayer = world.spatial!.state.actors.player!;
    const beforeAgent = world.spatial!.state.actors[agentId]!;
    const to = adjacent(world.spatial!.map, world.spatial!.state.doors, beforePlayer);
    const result = await session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: beforePlayer, to });
    expect(result).toEqual({ ok: true, refused: null });
    expect(world.spatial!.state.actors.player).toEqual(to);
    expect(world.spatial!.state.actors[agentId]).not.toEqual(beforeAgent);
    expect(llm.requests).toHaveLength(0);
    expect(session.snapshot().playerPos).toEqual(to);
  });

  it("rejects stale origin, stale stage, and cadence violations without moving", async () => {
    const timer = clock();
    const session = PlaySession.start(spec, "movement-rejections", 1, timer);
    const llm = new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] });
    const current = session.world.spatial!.state.actors.player!;
    const to = adjacent(session.world.spatial!.map, session.world.spatial!.state.doors, current);
    const unchanged = structuredClone(current);
    await expect(session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: { x: current.x + 1, y: current.y }, to })).resolves.toMatchObject({ ok: false, error: { code: "stale_state" } });
    await expect(session.action(llm, { type: "move_step", stageId: "wrong-stage", from: current, to })).resolves.toMatchObject({ ok: false, error: { code: "stale_state" } });
    expect(session.world.spatial!.state.actors.player).toEqual(unchanged);
    await expect(session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: current, to })).resolves.toEqual({ ok: true, refused: null });
    const moved = structuredClone(session.world.spatial!.state.actors.player);
    const next = adjacent(session.world.spatial!.map, session.world.spatial!.state.doors, moved!);
    await expect(session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: moved!, to: next })).resolves.toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(session.world.spatial!.state.actors.player).toEqual(moved);
  });

  it("refuses blocked doors, diagonal steps, and long jumps without changing position", async () => {
    const timer = clock();
    const session = PlaySession.start(spec, "movement-invalid", 1, timer);
    const llm = new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] });
    const spatial = session.world.spatial!;
    const door = spatial.map.doors.find((candidate) => spatial.state.doors[candidate.id] === "closed")!;
    const player = spatial.state.actors.player!;
    const path = findPath(spatial.map, spatial.state.doors, player, door.outside);
    expect(path).not.toBeNull();
    for (const point of path!) expect(moveActorStep(session.world, "player", point).ok).toBe(true);
    const outside = spatial.state.actors.player!;
    const blocked = await session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: outside, to: door.position });
    expect(blocked).toMatchObject({ ok: true });
    expect((blocked as { ok: true; refused: string | null }).refused).toBeTruthy();
    expect(spatial.state.actors.player).toEqual(outside);
    timer.advance(160);
    const diagonal = await session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: outside, to: { x: outside.x + 1, y: outside.y + 1 } });
    expect(diagonal).toMatchObject({ ok: true });
    expect(spatial.state.actors.player).toEqual(outside);
    timer.advance(160);
    const jump = await session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: outside, to: { x: outside.x + 2, y: outside.y } });
    expect(jump).toMatchObject({ ok: true });
    expect(spatial.state.actors.player).toEqual(outside);
  });

  it("rejects legacy teleport and position actions", async () => {
    const session = PlaySession.start(spec, "movement-legacy", 1, clock());
    const llm = new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] });
    await expect(session.action(llm, { type: "position", position: { x: 1, y: 1 } } as never)).resolves.toEqual({ ok: false, error: { code: "invalid_request", message: "Use adjacent tile movement." } });
    await expect(session.action(llm, { type: "move_room", toRoomId: spec.stages[0]!.rooms[0]!.id } as never)).resolves.toEqual({ ok: false, error: { code: "invalid_request", message: "Use adjacent tile movement." } });
  });
});
