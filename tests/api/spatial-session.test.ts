import { loadI1Spec } from "@adventure/generation/fixtures";
import { isWalkable, type Point } from "@adventure/game-core";
import { moveActorStep } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => {
  spec = await loadI1Spec();
});

describe("spatial session initialization", () => {
  it("starts from the compiled spatial world with authoritative actor positions", () => {
    const session = PlaySession.start(spec, "spatial-session-start", 1);
    const snapshot = session.snapshot();
    const spatial = snapshot.world.spatial!;
    expect(spatial.map.stageId).toBe(spec.stages[0]!.id);
    expect(Object.keys(spatial.state.actors).sort()).toEqual(["player", ...spec.stages[0]!.agents.map((agent) => agent.id)].sort());
    expect(snapshot.playerPos).toEqual(spatial.state.actors.player);
    expect(Object.keys(snapshot.world.rooms)).not.toContain("__outdoors__");
    expect(session.state({ enabled: false, deadlineAt: null }).playerPos).toEqual(spatial.state.actors.player);
  });

  it("persists an authoritative move through snapshot and resume without aliasing", () => {
    const session = PlaySession.start(spec, "spatial-session-move", 1);
    const before = session.snapshot();
    const spatial = before.world.spatial!;
    const from = spatial.state.actors.player!;
    const candidates: Point[] = [{ x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y }, { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 }];
    const to = candidates.find((point) => isWalkable(spatial.map, spatial.state.doors, point));
    expect(to).toBeDefined();
    expect(moveActorStep(session.world, "player", to!).ok).toBe(true);
    const moved = session.snapshot();
    const resumed = PlaySession.resume(spec, "spatial-session-move", 1, moved);
    expect(resumed.snapshot().playerPos).toEqual(to);
    expect(resumed.state({ enabled: false, deadlineAt: null }).playerPos).toEqual(to);
    moved.world.spatial!.state.actors.player!.x += 1;
    expect(resumed.snapshot().playerPos).toEqual(to);
  });

  it("rejects a persisted snapshot without spatial state", () => {
    const session = PlaySession.start(spec, "spatial-session-invalid", 1);
    const malformed = session.snapshot();
    delete (malformed.world as { spatial?: unknown }).spatial;
    expect(() => PlaySession.resume(spec, "spatial-session-invalid", 1, malformed)).toThrow("This attempt requires a new compatible adventure version.");
  });
});
