import { loadI1Spec } from "@adventure/generation/fixtures";
import { FakeLlmClient } from "@adventure/orchestration";
import { beforeAll, describe, expect, it } from "vitest";

import { getState, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";

const attemptId = "state-read-concurrency";
const studentId = "state-read-student";
let spec: Awaited<ReturnType<typeof loadI1Spec>>;

beforeAll(async () => { spec = await loadI1Spec(); });

describe("concurrent initial state reads", () => {
  it("initializes once and retries the losing stale read", async () => {
    const record: AttemptRecord = { attemptId, studentId, adventureId: spec.id, publishedVersion: 1, status: "active", stageDeadlineAt: null, spec, snapshot: null, runtimeRevision: 0 };
    const store = new MemoryPlayStore([record]);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "unused", actions: [] })] });
    const deps: PlayServiceDeps = { store, llm };
    const [first, second] = await Promise.all([getState(deps, attemptId, studentId), getState(deps, attemptId, studentId)]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.state.map).toEqual(first.state.map);
      expect(second.state.playerPos).toEqual(first.state.playerPos);
      expect(second.state.revision).toBe(first.state.revision);
    }
    expect(store.saved).toHaveLength(1);
    expect(llm.requests).toHaveLength(0);
  });
});
