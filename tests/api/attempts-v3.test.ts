import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EngineSpec, type EngineState, type PendingCheck, pendingCheckIds } from "@adventure/engine";
import { FakeLlmClient, type LlmRequest } from "@adventure/orchestration";
import type { GameEvent } from "@adventure/play-contract";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createAttempt,
  getAttempt,
  flagsFromEvents,
  postAction,
  runPostTurnChecks,
  type V3PlayServiceDeps,
} from "@/lib/play/v3/service";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";

const USER_ID = "student-1";
const OTHER_USER_ID = "student-2";
const ADVENTURE_ID = "adventure-1";
const SCHOOL_ID = "school-1";
const GOLDEN_SOURCE = resolve(process.cwd(), "fixtures/golden-1819.json");
let goldenSpec: ReturnType<typeof EngineSpec.parse>;

beforeAll(() => {
  goldenSpec = EngineSpec.parse(JSON.parse(readFileSync(GOLDEN_SOURCE, "utf8")));
});

function fakeLlm(flagged = false): FakeLlmClient {
  return new FakeLlmClient({
    replies: [
      (request: LlmRequest) => request.schemaName === "v3_post_turn_check"
        ? JSON.stringify({
            conveyed: [],
            assertedUndiscovered: false,
            assertion: null,
            moderation: {
              flagged,
              category: flagged ? "abusive" : "none",
              reason: flagged ? "insult" : null,
            },
          })
        : JSON.stringify({ reply: "A reply." }),
    ],
  });
}

function setup(options: {
  isPublic?: boolean;
  status?: string;
  activeMember?: boolean;
  env?: NodeJS.ProcessEnv;
  store?: MemoryV3PlayStore;
  flagged?: boolean;
} = {}) {
  const store = options.store ?? new MemoryV3PlayStore();
  store.addAdventure({
    id: ADVENTURE_ID,
    schoolId: SCHOOL_ID,
    ownerId: USER_ID,
    isPublic: options.isPublic,
    status: options.status ?? "published",
    specVersion: 1,
    spec: goldenSpec,
  });
  store.addMember(SCHOOL_ID, USER_ID, options.activeMember ?? true);

  let time = 1_000;
  const llm = fakeLlm(options.flagged ?? false);
  const deps: V3PlayServiceDeps = {
    store,
    llm: () => llm,
    now: () => time,
    env: {
      V3_ENABLED: "true",
      V3_SCHOOL_IDS: SCHOOL_ID,
      V3_RATE_LIMIT_PER_10S: "20",
      ...options.env,
    },
  };
  return { store, deps, llm, setTime: (next: number) => { time = next; } };
}

async function create(deps: V3PlayServiceDeps) {
  const result = await createAttempt(deps, USER_ID, ADVENTURE_ID);
  expect(result.status).toBe(201);
  return result.body as { attemptId: string; revision: number; view: { phase: string }; resumed: boolean };
}

async function createPendingMessage(deps: V3PlayServiceDeps, attemptId: string, text: string) {
  let revision = 0;
  for (const action of [
    { type: "continue" },
    { type: "continue" },
    { type: "enterRoom", roomId: "balai" },
    { type: "message", characterId: "temenggong", text },
  ] as const) {
    const result = await postAction(deps, USER_ID, attemptId, { revision, action });
    expect(result.status).toBe(200);
    revision = (result.body as { revision: number }).revision;
  }
  const attempt = await deps.store.loadAttempt(attemptId);
  expect(attempt).not.toBeNull();
  return (attempt!.state as EngineState).pendingChecks[0]!;
}

describe("v3 attempts API service", () => {
  it("conceals disabled schools and inactive members", async () => {
    const disabled = setup({ env: { V3_ENABLED: "0" } });
    expect((await createAttempt(disabled.deps, USER_ID, ADVENTURE_ID)).status).toBe(404);

    const disallowed = setup({ env: { V3_SCHOOL_IDS: "school-2" } });
    expect((await createAttempt(disallowed.deps, USER_ID, ADVENTURE_ID)).status).toBe(404);

    const inactive = setup({ activeMember: false });
    expect((await createAttempt(inactive.deps, USER_ID, ADVENTURE_ID)).status).toBe(404);
    expect((await createAttempt(inactive.deps, USER_ID, "missing")).status).toBe(404);
  });

  it("lets public outsiders start, resume and act, while keeping attempts private", async () => {
    const { deps, store } = setup({ isPublic: true, activeMember: false });
    const first = await create(deps);
    expect((await createAttempt(deps, USER_ID, ADVENTURE_ID)).status).toBe(200);
    expect((await getAttempt(deps, USER_ID, first.attemptId)).status).toBe(200);
    expect((await postAction(deps, USER_ID, first.attemptId, { revision: 0, action: { type: "continue" } })).status).toBe(200);
    expect((await getAttempt(deps, OTHER_USER_ID, first.attemptId)).status).toBe(404);
    expect((await postAction(deps, OTHER_USER_ID, first.attemptId, { revision: 1, action: { type: "tick" } })).status).toBe(404);
    const adventure = (await store.loadAdventure(ADVENTURE_ID))!;
    store.addAdventure({ ...adventure, isPublic: false });
    expect((await getAttempt(deps, USER_ID, first.attemptId)).status).toBe(404);
    expect((await postAction(deps, USER_ID, first.attemptId, { revision: 1, action: { type: "tick" } })).status).toBe(404);
  });

  it("does not expose public drafts, archived adventures or disabled schools", async () => {
    for (const status of ["draft", "archived"]) {
      const { deps } = setup({ isPublic: true, activeMember: false, status });
      expect((await createAttempt(deps, USER_ID, ADVENTURE_ID)).status).not.toBe(201);
    }
    const { deps } = setup({ isPublic: true, env: { V3_ENABLED: "0" } });
    expect((await createAttempt(deps, USER_ID, ADVENTURE_ID)).status).toBe(404);
  });

  it("requires a published adventure and resumes the latest attempt", async () => {
    const draft = setup({ status: "draft" });
    expect(await createAttempt(draft.deps, USER_ID, ADVENTURE_ID)).toMatchObject({
      status: 409,
      body: { error: { code: "not_open" } },
    });

    const fixture = setup();
    const first = await create(fixture.deps);
    expect(first).toMatchObject({ revision: 0, resumed: false, view: { phase: "briefing" } });
    const resumed = await createAttempt(fixture.deps, USER_ID, ADVENTURE_ID);
    expect(resumed).toMatchObject({
      status: 200,
      body: { attemptId: first.attemptId, revision: 0, resumed: true, view: { phase: "briefing" } },
    });
  });

  it("serves only an owner's projected view and uses the pinned spec", async () => {
    const fixture = setup();
    const created = await create(fixture.deps);
    const anotherVersion = {
      ...goldenSpec,
      role: { ...goldenSpec.role, situation: "Unpinned live spec" },
    };
    fixture.store.addVersionSpec(ADVENTURE_ID, 2, anotherVersion);
    fixture.store.addAdventure({
      id: ADVENTURE_ID,
      schoolId: SCHOOL_ID,
      ownerId: USER_ID,
      status: "published",
      specVersion: 2,
      spec: anotherVersion,
    });

    const owner = await getAttempt(fixture.deps, USER_ID, created.attemptId);
    expect(owner).toMatchObject({
      status: 200,
      body: { revision: 0, view: { briefing: { situation: goldenSpec.role.situation } } },
    });
    expect((await getAttempt(fixture.deps, OTHER_USER_ID, created.attemptId)).status).toBe(404);
  });

  it("continues at the expected revision and returns the current projection when stale", async () => {
    const fixture = setup();
    const created = await create(fixture.deps);
    const continued = await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 0,
      action: { type: "continue" },
    });
    expect(continued).toMatchObject({ status: 200, body: { revision: 1, view: { phase: "stage" } } });

    const stale = await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 0,
      action: { type: "tick" },
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { error: { code: "stale_state" }, revision: 1, view: { phase: "stage" } },
    });
  });

  it("rejects forged server actions and maps engine errors", async () => {
    const fixture = setup();
    const created = await create(fixture.deps);
    expect(await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 0,
      action: { type: "postTurn", messageId: "forged", result: {} },
    })).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });

    expect(await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 0,
      action: { type: "act", actId: "a1-faithful" },
    })).toMatchObject({ status: 409, body: { error: { code: "illegal_phase" } } });
  });

  it("rate-limits at the configured request count and resets after the window", async () => {
    const fixture = setup();
    const created = await create(fixture.deps);
    let revision = 0;
    for (let request = 0; request < 20; request += 1) {
      const result = await postAction(fixture.deps, USER_ID, created.attemptId, {
        revision,
        action: { type: "tick" },
      });
      expect(result.status).toBe(200);
      revision = (result.body as { revision: number }).revision;
    }

    expect(await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision,
      action: { type: "tick" },
    })).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });

    fixture.setTime(11_001);
    expect((await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision,
      action: { type: "tick" },
    })).status).toBe(200);
  });

  it("blocks costly actions at the token ceiling but still allows continue and tick", async () => {
    const fixture = setup({ env: { V3_ATTEMPT_TOKEN_CEILING: "500" } });
    const created = await create(fixture.deps);
    fixture.store.setTokensUsed(created.attemptId, 500);

    expect(await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 0,
      action: { type: "message", characterId: "temenggong", text: "Hello." },
    })).toMatchObject({
      status: 429,
      body: {
        error: {
          code: "attempt_limit",
          message: "This attempt has reached its limit. Your notes are saved; ask your teacher to continue.",
        },
      },
    });

    const continued = await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 0,
      action: { type: "continue" },
    });
    expect(continued.status).toBe(200);
    expect((await postAction(fixture.deps, USER_ID, created.attemptId, {
      revision: 1,
      action: { type: "tick" },
    })).status).toBe(200);
  });

  it("lets only one concurrent save advance a revision", async () => {
    const fixture = setup();
    const created = await create(fixture.deps);
    const results = await Promise.all([
      postAction(fixture.deps, USER_ID, created.attemptId, { revision: 0, action: { type: "continue" } }),
      postAction(fixture.deps, USER_ID, created.attemptId, { revision: 0, action: { type: "continue" } }),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
  });

  it("applies pending post-turn checks and retries a concurrent write", async () => {
    class RacingStore extends MemoryV3PlayStore {
      raceNextSave = false;

      override async save(id: string, revision: number, state: unknown, events: GameEvent[]) {
        if (this.raceNextSave) {
          this.raceNextSave = false;
          const latest = await this.loadAttempt(id);
          if (latest) await super.save(id, revision, latest.state, []);
        }
        return super.save(id, revision, state, events);
      }
    }

    const store = new RacingStore();
    const fixture = setup({ store });
    const created = await create(fixture.deps);
    let revision = 0;
    for (const action of [
      { type: "continue" },
      { type: "continue" },
      { type: "enterRoom", roomId: "balai" },
      { type: "message", characterId: "temenggong", text: "What happened?" },
    ] as const) {
      const result = await postAction(fixture.deps, USER_ID, created.attemptId, { revision, action });
      expect(result.status).toBe(200);
      revision = (result.body as { revision: number }).revision;
    }

    const afterMessage = await store.loadAttempt(created.attemptId);
    expect(afterMessage).not.toBeNull();
    const pending = pendingCheckIds(afterMessage!.state as EngineState);
    expect(pending).toHaveLength(1);
    store.raceNextSave = true;
    await runPostTurnChecks(fixture.deps, created.attemptId, pending);

    const checked = await store.loadAttempt(created.attemptId);
    expect(checked?.revision).toBe(revision + 2);
    expect(pendingCheckIds(checked!.state as EngineState)).toEqual([]);
    expect(fixture.llm.requests.filter((request) => request.schemaName === "v3_post_turn_check")).toHaveLength(1);
  });

  it("saves a moderation flag with the student's excerpt and is idempotent", async () => {
    const fixture = setup({ flagged: true });
    const created = await create(fixture.deps);
    const text = "I hate you; you are a fool.";
    const pending = await createPendingMessage(fixture.deps, created.attemptId, text);

    await runPostTurnChecks(fixture.deps, created.attemptId, [pending.messageId]);

    expect(fixture.store.flags).toEqual([{
      attemptId: created.attemptId,
      messageId: pending.messageId,
      category: "abusive",
      excerpt: text,
      result: { reason: "insult", characterId: "temenggong", stageIndex: 0 },
    }]);
    expect(fixture.store.savedEvents.flatMap((save) => save.events)).toContainEqual(
      expect.objectContaining({
        type: "flag",
        messageId: pending.messageId,
        category: "abusive",
        reason: "insult",
      }),
    );

    await runPostTurnChecks(fixture.deps, created.attemptId, [pending.messageId]);
    expect(fixture.store.flags).toHaveLength(1);
  });

  it("does not save a moderation flag for a non-flagged check", async () => {
    const fixture = setup();
    const created = await create(fixture.deps);
    const pending = await createPendingMessage(fixture.deps, created.attemptId, "A calm question.");

    await runPostTurnChecks(fixture.deps, created.attemptId, [pending.messageId]);

    expect(fixture.store.flags).toEqual([]);
    expect(fixture.store.savedEvents.flatMap((save) => save.events))
      .not.toContainEqual(expect.objectContaining({ type: "flag" }));
  });

  it("builds note-turn excerpts and caps excerpts at 1000 characters", () => {
    const pending: PendingCheck = {
      messageId: "message-1",
      characterId: "temenggong",
      stageIndex: 2,
      revealable: [],
      studentNotes: [],
      turn: { kind: "note", text: "Quoted words", note: "Student note" },
      reply: "A reply.",
    };
    const flag: GameEvent = {
      type: "flag",
      at: 1,
      stageIndex: 2,
      messageId: "message-1",
      category: "abusive",
      reason: "insult",
    };

    expect(flagsFromEvents(pending, [flag])).toMatchObject([
      { excerpt: "Quoted words\nStudent note", result: { characterId: "temenggong", stageIndex: 2 } },
    ]);
    expect(flagsFromEvents({
      ...pending,
      turn: { kind: "note", text: null, note: "x".repeat(1200) },
    }, [flag])[0]?.excerpt).toHaveLength(1000);
  });
});
