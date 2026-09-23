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

function straightPath(session: PlaySession, length: number): Point[] {
  const spatial = session.world.spatial!;
  const from = spatial.state.actors.player!;
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const path = directions
    .map((direction) => Array.from({ length }, (_, index) => ({ x: from.x + direction.x * (index + 1), y: from.y + direction.y * (index + 1) })))
    .find((candidate) => candidate.every((point) => isWalkable(spatial.map, spatial.state.doors, point)));
  if (!path) throw new Error(`fixture player has no straight path of ${length} tiles`);
  return path;
}

function walkablePath(session: PlaySession, length: number): Point[] {
  const spatial = session.world.spatial!;
  let current = spatial.state.actors.player!;
  let previous: Point | null = null;
  return Array.from({ length }, () => {
    const candidates = [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }];
    const next = candidates.find((point) => isWalkable(spatial.map, spatial.state.doors, point) && (!previous || point.x !== previous.x || point.y !== previous.y))
      ?? candidates.find((point) => isWalkable(spatial.map, spatial.state.doors, point));
    if (!next) throw new Error(`fixture player has no walkable path of ${length} tiles`);
    previous = current;
    current = next;
    return next;
  });
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

  it("rejects stale origin and stale stage while accepting token-bucket movement", async () => {
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
    await expect(session.action(llm, { type: "move_step", stageId: spec.stages[0]!.id, from: moved!, to: next })).resolves.toEqual({ ok: true, refused: null });
    expect(session.world.spatial!.state.actors.player).toEqual(next);
  });

  it("allows a burst before refilling and sustains one step per 160ms", async () => {
    const timer = clock();
    const session = PlaySession.start(spec, "movement-batch", 1, timer);
    const llm = new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] });
    const path = walkablePath(session, 8);
    const stageId = spec.stages[0]!.id;
    const result = await session.action(llm, { type: "move_steps", stageId, from: session.world.spatial!.state.actors.player!, path });
    expect(result).toEqual({ ok: true, refused: null });
    expect(session.snapshot().playerPos).toEqual(path.at(-1));
    expect(session.snapshot().stageStats.actions).toBe(8);

    const nextPath = straightPath(session, 1);
    await expect(session.action(llm, { type: "move_steps", stageId, from: path.at(-1)!, path: nextPath })).resolves.toMatchObject({ ok: false, error: { code: "rate_limited" } });
    timer.advance(160);
    await expect(session.action(llm, { type: "move_steps", stageId, from: path.at(-1)!, path: nextPath })).resolves.toEqual({ ok: true, refused: null });

    const sustainedTimer = clock();
    const sustained = PlaySession.start(spec, "movement-sustained", 1, sustainedTimer);
    for (let index = 0; index < 12; index += 1) {
      const from = sustained.world.spatial!.state.actors.player!;
      const to = adjacent(sustained.world.spatial!.map, sustained.world.spatial!.state.doors, from);
      await expect(sustained.action(llm, { type: "move_step", stageId, from, to })).resolves.toEqual({ ok: true, refused: null });
      sustainedTimer.advance(160);
    }
  });

  it("applies a valid prefix before refusing a blocked batch and rejects invalid batches", async () => {
    const timer = clock();
    const session = PlaySession.start(spec, "movement-batch-partial", 1, timer);
    const llm = new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] });
    const spatial = session.world.spatial!;
    const initial = spatial.state.actors.player!;
    const door = spatial.map.doors.find((candidate) => spatial.state.doors[candidate.id] === "closed")!;
    const route = findPath(spatial.map, spatial.state.doors, initial, door.outside);
    expect(route).not.toBeNull();
    expect(route!.length).toBeGreaterThan(1);
    for (const point of route!.slice(0, -1)) expect(moveActorStep(session.world, "player", point)).toMatchObject({ ok: true });
    const from = spatial.state.actors.player!;
    const first = door.outside;
    const blocked = door.position;
    const stageId = spec.stages[0]!.id;
    const refused = await session.action(llm, { type: "move_steps", stageId, from, path: [first, blocked, { x: blocked.x + 1, y: blocked.y }] });
    expect(refused).toMatchObject({ ok: true, refused: expect.any(String) });
    expect(session.snapshot().playerPos).toEqual(first);
    expect(session.snapshot().stageStats.actions).toBe(1);

    timer.advance(160);
    await expect(session.action(llm, { type: "move_steps", stageId, from: { x: first.x + 1, y: first.y }, path: [first] })).resolves.toMatchObject({ ok: false, error: { code: "stale_state" } });
    await expect(session.action(llm, { type: "move_steps", stageId, from: first, path: [] })).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    await expect(session.action(llm, { type: "move_steps", stageId, from: first, path: Array.from({ length: 9 }, () => first) })).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
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
