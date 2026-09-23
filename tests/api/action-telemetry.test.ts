/**
 * Stage telemetry and the revision only move when the world actually does: an
 * action filterActions drops and one applyAction refuses are non-events, not
 * counted actions that burn a revision and make every poller re-render.
 */
import { isWalkable, type StageMap } from "@adventure/game-core";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { FakeLlmClient } from "@adventure/orchestration";
import type { AdventureSpec } from "@adventure/generation/spec";
import { beforeAll, describe, expect, it } from "vitest";

import { getState, postAction, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";

const ATTEMPT = "attempt-telemetry";
const STUDENT = "student-1";

let spec: AdventureSpec;

function record(): AttemptRecord {
  return {
    attemptId: ATTEMPT,
    studentId: STUDENT,
    adventureId: "adv-1",
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec,
    snapshot: null,
    runtimeRevision: 0,
  };
}

function deps() {
  const store = new MemoryPlayStore([record()]);
  const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "Hm.", actions: [] })] });
  const d: PlayServiceDeps = { store, llm };
  return { d, store };
}

function stats(store: MemoryPlayStore) {
  const snapshot = store.saved.at(-1)?.snapshot;
  return { revision: snapshot?.revision ?? 0, actions: snapshot?.stageStats.actions ?? 0 };
}

beforeAll(async () => {
  spec = await loadI1Spec();
});

describe("POST action telemetry", () => {
  it("does not count an action applyAction refuses, nor burn a revision", async () => {
    const { d, store } = deps();
    const state = (await getState(d, ATTEMPT, STUDENT));
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const before = stats(store);

    // The player is in the spawn room, not inside another enclosed room.
    const other = spec.stages[0]!.rooms.find((room) => room.id !== state.state.currentRoomId && room.enclosure === "enclosed")
      ?? spec.stages[0]!.rooms.find((room) => room.id !== state.state.currentRoomId)!;
    const result = await postAction(d, ATTEMPT, STUDENT, { type: "open_door", roomId: other.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.refused).toEqual(expect.any(String));
    expect(stats(store)).toEqual(before);
    expect(result.state.revision).toBe(state.state.revision);
  });

  it("does not count an action filterActions drops", async () => {
    const { d, store } = deps();
    await getState(d, ATTEMPT, STUDENT);
    const before = stats(store);

    // record_private_note is server-side only: a player may not emit it.
    const result = await postAction(d, ATTEMPT, STUDENT, { type: "record_private_note", note: "sneaky" } as never);

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(stats(store)).toEqual(before);
  });

  it("still counts an action the world accepts", async () => {
    const { d, store } = deps();
    const state = await getState(d, ATTEMPT, STUDENT);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const before = stats(store);

    // One adjacent walkable tile: a move the world accepts.
    const map = { ...state.state.map!, seed: "" } as StageMap;
    const doors = Object.fromEntries(map.doors.map((door) => [door.id, state.state.rooms.find((room) => room.id === door.roomId)?.doorOpen ? "open" as const : "closed" as const]));
    const from = state.state.playerPos!;
    const to = [{ x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y }, { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 }].find((point) => isWalkable(map, doors, point))!;
    const result = await postAction(d, ATTEMPT, STUDENT, { type: "move_step", stageId: state.state.stage.id, from, to });

    expect(result).toMatchObject({ ok: true, value: { refused: null } });
    expect(stats(store).actions).toBe((before.actions ?? 0) + 1);
    expect(stats(store).revision).toBe((before.revision ?? 0) + 1);
  });
});
