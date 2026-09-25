import { findPath, type Point, type StageMap } from "@adventure/game-core";
import { expect } from "vitest";

import { getState, postAction, postGoalCheck, postMessage, type PlayServiceDeps } from "@/lib/play/service";
import type { PlayState } from "@/lib/play/session";

export class AdmissionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdmissionRefusedError";
  }
}

export type PlayDriver = {
  deps: PlayServiceDeps;
  attemptId: string;
  userId: string;
  advanceTime: () => void | Promise<void>;
  capture?: (label: string, payload: unknown) => void;
};

function doorsOf(state: PlayState, map: StageMap) {
  return Object.fromEntries(map.doors.map((door) => [door.id, state.rooms.find((room) => room.id === door.roomId)?.doorOpen ? "open" : "closed"]));
}

export async function stateOf(driver: PlayDriver): Promise<PlayState> {
  const result = await getState(driver.deps, driver.attemptId, driver.userId);
  driver.capture?.("state", result);
  if (!result.ok) throw new Error(`state failed: ${JSON.stringify(result.error)}`);
  return result.state;
}

export async function walkTo(driver: PlayDriver, target: Point): Promise<PlayState> {
  let state = await stateOf(driver);
  const map = { ...state.map!, seed: "" } as StageMap;
  let path = findPath(map, doorsOf(state, map), state.playerPos!, target);
  if (!path) {
    const room = map.rooms.find((candidate) => target.x >= candidate.x && target.x < candidate.x + candidate.width && target.y >= candidate.y && target.y < candidate.y + candidate.height);
    const door = room?.enclosure === "enclosed" ? map.doors.find((candidate) => candidate.roomId === room.id) : undefined;
    if (door) {
      await walkTo(driver, door.outside);
      const knocked = await postAction(driver.deps, driver.attemptId, driver.userId, { type: "knock", roomId: room!.id });
      driver.capture?.("knock", knocked);
      expect(knocked).toMatchObject({ ok: true, value: { refused: null } });
      if (!knocked.ok || knocked.value.refused) throw new AdmissionRefusedError(knocked.ok ? knocked.value.refused ?? "door admission refused" : knocked.error.message);
      if (!knocked.state.rooms.find((candidate) => candidate.id === door.roomId)?.doorOpen) throw new AdmissionRefusedError(`Door to ${door.roomId} remains closed.`);
      state = await stateOf(driver);
      path = findPath({ ...state.map!, seed: "" } as StageMap, doorsOf(state, map), state.playerPos!, target);
    }
  }
  if (!path) throw new Error(`no path to ${target.x},${target.y}`);
  for (const to of path) {
    await driver.advanceTime();
    state = await stateOf(driver);
    const result = await postAction(driver.deps, driver.attemptId, driver.userId, { type: "move_step", stageId: state.stage.id, from: state.playerPos!, to });
    driver.capture?.("move_step", result);
    expect(result).toMatchObject({ ok: true, value: { refused: null } });
    if (!result.ok) throw new Error(`move failed: ${JSON.stringify(result.error)}`);
    state = result.state;
  }
  return state;
}

export async function enterRoom(driver: PlayDriver, roomId: string): Promise<PlayState> {
  let state = await stateOf(driver);
  const room = state.rooms.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error(`unknown room ${roomId}`);
  const map = { ...state.map!, seed: "" } as StageMap;
  const mapRoom = map.rooms.find((candidate) => candidate.id === roomId);
  if (!mapRoom) throw new Error(`unknown map room ${roomId}`);
  const door = map.doors.find((candidate) => candidate.roomId === roomId);
  const target = mapRoom.enclosure === "open" ? { x: mapRoom.x + Math.floor(mapRoom.width / 2), y: mapRoom.y + Math.floor(mapRoom.height / 2) } : door?.inside;
  if (!target) throw new Error(`room ${roomId} has no target`);
  if (!room.doorOpen && door) {
    state = await walkTo(driver, door.outside);
    // Knocking gives the character inside a beat to answer the door (K4/#8).
    const knocked = await postAction(driver.deps, driver.attemptId, driver.userId, { type: "knock", roomId });
    driver.capture?.("knock", knocked);
    expect(knocked).toMatchObject({ ok: true, value: { refused: null } });
    if (!knocked.ok || knocked.value.refused) throw new AdmissionRefusedError(knocked.ok ? knocked.value.refused ?? "door admission refused" : knocked.error.message);
      if (!knocked.state.rooms.find((candidate) => candidate.id === door.roomId)?.doorOpen) throw new AdmissionRefusedError(`Door to ${door.roomId} remains closed.`);
  }
  return walkTo(driver, target);
}

export async function inspectEvidence(driver: PlayDriver, evidenceId: string): Promise<PlayState> {
  const state = await stateOf(driver);
  // Walking to another goal can now pick up this evidence along the way.
  if (state.journal.some((entry) => entry.id === evidenceId)) return state;
  const item = state.evidenceHere.find((candidate) => candidate.id === evidenceId);
  if (!item) throw new Error(`evidence ${evidenceId} is not shown`);
  if (item.position && !item.canInspect) {
    const arrived = await walkTo(driver, item.position);
    if (arrived.journal.some((entry) => entry.id === evidenceId)) return arrived;
  }
  const result = await postAction(driver.deps, driver.attemptId, driver.userId, { type: "inspect", evidenceId });
  driver.capture?.("inspect", result);
  expect(result).toMatchObject({ ok: true, value: { refused: null } });
  if (!result.ok) throw new Error(`inspect failed: ${JSON.stringify(result.error)}`);
  return result.state;
}

export async function talkToAgent(driver: PlayDriver, agentId: string, body = "A word, if you have one."): Promise<PlayState> {
  const state = await stateOf(driver);
  const agent = state.actors.find((actor) => actor.id === agentId);
  if (!agent?.position) throw new Error(`agent ${agentId} has no authoritative position`);
  await walkTo(driver, agent.position);
  const current = await stateOf(driver);
  const opening = await pacedMessage(driver, { roomId: current.currentRoomId!, body, addresseeId: agentId }, "message");
  return pacedMessage(driver, {
    roomId: opening.currentRoomId!,
    body: "Can you explain what leads you to that view?",
    addresseeId: agentId,
  }, "follow-up");
}

async function pacedMessage(driver: PlayDriver, input: Parameters<typeof postMessage>[3], label: string): Promise<PlayState> {
  // Conversation goals require two replies. Fast tests can exhaust the same
  // persisted speech bucket that paces real players, so wait for its refill.
  for (let retry = 0; retry <= 16; retry += 1) {
    const result = await postMessage(driver.deps, driver.attemptId, driver.userId, input);
    driver.capture?.("message", result);
    if (result.ok) {
      // As the play client does: check any goal the reply claimed, after the reply has landed.
      if (!result.state.goalCheckReady) return result.state;
      const checked = await postGoalCheck(driver.deps, driver.attemptId, driver.userId);
      driver.capture?.("goal-check", checked);
      return checked.ok ? checked.state : result.state;
    }
    if (result.error.code !== "rate_limited" || retry === 16) {
      throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
    }
    await driver.advanceTime();
  }
  throw new Error(`${label} stayed rate limited after 16 waits`);
}
