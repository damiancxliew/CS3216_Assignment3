import { loadI1Spec } from "@adventure/generation/fixtures";
import { PlaySession } from "@/lib/play/session";
import { beforeAll, describe, expect, it } from "vitest";

import { MemoryPlayStore, PlayConflictError, type AttemptRecord } from "@/lib/play/store";

const ATTEMPT = "attempt-concurrency";
const STUDENT = "student-concurrency";

let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => {
  spec = await loadI1Spec();
});

function record(snapshot: AttemptRecord["snapshot"], attemptId = ATTEMPT): AttemptRecord {
  return {
    attemptId,
    studentId: STUDENT,
    adventureId: spec.id,
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec,
    snapshot,
  };
}

const emptyEvents = {
  utterances: [],
  decisions: [],
  resolution: null,
  openedStageIndex: null,
  endingId: null,
} as const;

describe("MemoryPlayStore compare-and-swap", () => {
  it("keeps only the first concurrent revision and accepts an independent reload", async () => {
    const initial = PlaySession.start(spec, ATTEMPT, 1).snapshot();
    const store = new MemoryPlayStore([record(initial)]);
    const first = { ...initial, revision: initial.revision + 1 };
    const staleRecord = record(initial);

    await store.save(record(initial), first, emptyEvents);
    await expect(store.save(staleRecord, { ...initial, revision: initial.revision + 1 }, emptyEvents)).rejects.toBeInstanceOf(PlayConflictError);
    expect(store.saved).toHaveLength(1);
    expect((await store.load(ATTEMPT, STUDENT))?.snapshot?.revision).toBe(1);

    const reloaded = await store.load(ATTEMPT, STUDENT);
    expect(reloaded).not.toBeNull();
    const second = { ...reloaded!.snapshot!, revision: 2 };
    await store.save(reloaded!, second, emptyEvents);
    expect((await store.load(ATTEMPT, STUDENT))?.snapshot?.revision).toBe(2);
  });

  it("rejects same and lower revisions before saved mutation", async () => {
    const initial = PlaySession.start(spec, `${ATTEMPT}-lower`, 1).snapshot();
    const attemptId = `${ATTEMPT}-lower`;
    const store = new MemoryPlayStore([record(initial, attemptId)]);
    const current = { ...initial, revision: 2 };
    const events = { ...emptyEvents, utterances: [{ line: { tick: 0, seq: 1, roomId: 'room', speakerId: 'player', speakerName: 'Player', addresseeId: null, body: 'event' }, heardByPlayer: true, stageIndex: 0 }] };
    await store.save(record(initial, attemptId), current, events);
    events.utterances.push({ line: { tick: 0, seq: 2, roomId: 'room', speakerId: 'player', speakerName: 'Player', addresseeId: null, body: 'mutated' }, heardByPlayer: true, stageIndex: 0 });
    expect(store.saved[0]?.events.utterances).toHaveLength(1);
    const before = structuredClone(store.saved);
    await expect(store.save(record(current, attemptId), { ...current, revision: 2 }, emptyEvents)).rejects.toBeInstanceOf(PlayConflictError);
    await expect(store.save(record(current, attemptId), { ...current, revision: 1 }, emptyEvents)).rejects.toBeInstanceOf(PlayConflictError);
    expect(store.saved).toEqual(before);
  });
});
