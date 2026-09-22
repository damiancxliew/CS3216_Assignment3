import { describe, expect, it } from "vitest";

import { loadI1Spec } from "@adventure/generation/fixtures";
import {
  commitRuntimeAttemptDecision,
  createRuntimeAttempt,
  postMessageToRuntimeAttempt,
  projectRuntimeState,
  restoreRuntimeAttempt,
  snapshotRuntimeAttempt,
  type RuntimeSnapshot,
} from "@/lib/turn-api/runtime";

const LANDING = "landing-beach";
const SHIP_CABIN = "ship-cabin";
const OPTION_SIGN = "opt-sign-preliminary";

function withoutClock(state: ReturnType<typeof projectRuntimeState>) {
  return {
    ...state,
    timer: {
      ...state.timer,
      serverNow: "",
      secondsRemaining: null,
    },
  };
}

async function unlockedAttempt() {
  const spec = await loadI1Spec();
  const attempt = createRuntimeAttempt(spec);
  const posted = await postMessageToRuntimeAttempt(
    "snapshot-attempt",
    attempt,
    SHIP_CABIN,
    "Show me the instructions.",
  );
  expect(posted.ok).toBe(true);
  return { spec, attempt };
}

describe("Turn runtime snapshots", () => {
  it("round-trips a mutated attempt into an equivalent public state", async () => {
    const spec = await loadI1Spec();
    const attempt = createRuntimeAttempt(spec);
    const posted = await postMessageToRuntimeAttempt(
      "snapshot-attempt",
      attempt,
      LANDING,
      "What is the plan?",
    );
    expect(posted.ok).toBe(true);

    const snapshot = snapshotRuntimeAttempt(attempt);
    const restored = restoreRuntimeAttempt(spec, JSON.parse(JSON.stringify(snapshot)));

    expect(withoutClock(projectRuntimeState("snapshot-attempt", restored))).toEqual(
      withoutClock(projectRuntimeState("snapshot-attempt", attempt)),
    );
  });

  it("does not include private context in the serialized snapshot", async () => {
    const { spec, attempt } = await unlockedAttempt();
    const snapshot = snapshotRuntimeAttempt(attempt);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("fears the Sultan in Riau will repudiate");
    expect(serialized).not.toContain("stretching his instructions from Hastings");
    expect(serialized).not.toContain("privateContext");
    expect(spec.stages[0]?.agents.some((agent) => serialized.includes(agent.privateContext.hiddenInterests))).toBe(
      false,
    );
  });

  it("rejects snapshots with invalid version, stage, room, actor, or resolution data", async () => {
    const { spec, attempt } = await unlockedAttempt();
    const snapshot = snapshotRuntimeAttempt(attempt);

    expect(() => restoreRuntimeAttempt(spec, { ...snapshot, version: 2 } as unknown as RuntimeSnapshot)).toThrow();
    expect(() => restoreRuntimeAttempt(spec, { ...snapshot, stageIndex: 99 })).toThrow();

    const missingRoom = structuredClone(snapshot);
    delete missingRoom.world.rooms[LANDING];
    expect(() => restoreRuntimeAttempt(spec, missingRoom)).toThrow();

    const extraActor = structuredClone(snapshot);
    extraActor.world.actors.foreign = structuredClone(extraActor.world.actors.player);
    expect(() => restoreRuntimeAttempt(spec, extraActor)).toThrow();

    const resolved = createRuntimeAttempt(spec);
    await postMessageToRuntimeAttempt("foreign-resolution", resolved, SHIP_CABIN, "Read this.");
    await commitRuntimeAttemptDecision("foreign-resolution", resolved, OPTION_SIGN);
    const foreignResolution = snapshotRuntimeAttempt(resolved);
    foreignResolution.currentResolution = structuredClone(resolved.resolutions[0]);
    expect(() => restoreRuntimeAttempt(spec, foreignResolution)).toThrow();
  });

  it("continues through a decision after restoration", async () => {
    const { spec, attempt } = await unlockedAttempt();
    const restored = restoreRuntimeAttempt(
      spec,
      JSON.parse(JSON.stringify(snapshotRuntimeAttempt(attempt))),
    );

    const result = await commitRuntimeAttemptDecision("restored-attempt", restored, OPTION_SIGN);

    expect(result?.resolution.announcement).toContain("You commit to:");
    expect(result?.resolution.nextStageId).toBe("stage-sultan");
    expect(result?.state.stage.id).toBe("stage-sultan");
  });
});
