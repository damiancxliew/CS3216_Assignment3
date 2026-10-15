import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EngineSpec, type EngineState, pendingCheckIds } from "@adventure/engine";
import { FakeLlmClient, type LlmRequest } from "@adventure/orchestration";
import type { PlayerView } from "@adventure/play-contract";
import { beforeAll, describe, expect, it } from "vitest";

import {
  previewAction,
  previewCheck,
  startPreview,
  type V3PreviewDeps,
} from "@/lib/play/v3/preview";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";

const OWNER_ID = "teacher-owner";
const OTHER_USER_ID = "other-user";
const ADMIN_ID = "school-admin";
const ADVENTURE_ID = "preview-adventure";
const SCHOOL_ID = "school-1";
const GOLDEN_SOURCE = resolve(process.cwd(), "fixtures/golden-1819.json");
let goldenSpec: ReturnType<typeof EngineSpec.parse>;

beforeAll(() => {
  goldenSpec = EngineSpec.parse(JSON.parse(readFileSync(GOLDEN_SOURCE, "utf8")));
});

function fakeLlm(): FakeLlmClient {
  return new FakeLlmClient({
    replies: [
      (request: LlmRequest) => request.schemaName === "v3_post_turn_check"
        ? JSON.stringify({
            conveyed: [],
            assertedUndiscovered: false,
            assertion: null,
            moderation: { flagged: false, category: "none", reason: null },
          })
        : JSON.stringify({ reply: "A reply." }),
    ],
  });
}

function setup(options: {
  ownerId?: string;
  status?: string;
  spec?: unknown | null;
  env?: NodeJS.ProcessEnv;
  store?: MemoryV3PlayStore;
} = {}) {
  const store = options.store ?? new MemoryV3PlayStore();
  store.addAdventure({
    id: ADVENTURE_ID,
    schoolId: SCHOOL_ID,
    ownerId: options.ownerId ?? OWNER_ID,
    status: options.status ?? "published",
    specVersion: 1,
    spec: options.spec === undefined ? goldenSpec : options.spec,
  });
  store.addMember(SCHOOL_ID, OWNER_ID);

  let time = 1_000;
  const llm = fakeLlm();
  const deps: V3PreviewDeps = {
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

type PreviewBody = {
  state: EngineState;
  view: PlayerView;
  pendingCheckIds?: string[];
};

function previewBody(result: { body: Record<string, unknown> }): PreviewBody {
  return result.body as PreviewBody;
}

describe("v3 teacher preview service", () => {
  it("starts an owner preview without saving an attempt or events", async () => {
    const fixture = setup();
    fixture.store.addMember(SCHOOL_ID, OWNER_ID, false);

    const result = await startPreview(fixture.deps, OWNER_ID, ADVENTURE_ID);
    expect(result.status).toBe(201);
    expect(previewBody(result).view.phase).toBe("briefing");
    expect(await fixture.store.findLatestAttempt(ADVENTURE_ID, OWNER_ID)).toBeNull();
    expect(fixture.store.savedEvents).toEqual([]);
  });

  it("allows draft adventures to be previewed", async () => {
    const fixture = setup({ status: "draft" });
    expect((await startPreview(fixture.deps, OWNER_ID, ADVENTURE_ID)).status).toBe(201);
  });

  it("allows school admins and platform admins to preview without owning the adventure", async () => {
    const schoolAdmin = setup();
    schoolAdmin.store.addSchoolAdmin(SCHOOL_ID, ADMIN_ID);
    expect((await startPreview(schoolAdmin.deps, ADMIN_ID, ADVENTURE_ID)).status).toBe(201);

    const platformAdmin = setup();
    platformAdmin.store.addPlatformAdmin(OTHER_USER_ID);
    expect((await startPreview(platformAdmin.deps, OTHER_USER_ID, ADVENTURE_ID)).status).toBe(201);
  });

  it("conceals previews from non-admin members, disallowed schools, and a disabled v3 flag", async () => {
    const nonAdmin = setup();
    nonAdmin.store.addMember(SCHOOL_ID, OTHER_USER_ID, true);
    expect((await startPreview(nonAdmin.deps, OTHER_USER_ID, ADVENTURE_ID)).status).toBe(404);

    const disallowed = setup({ env: { V3_SCHOOL_IDS: "school-2" } });
    expect((await startPreview(disallowed.deps, OWNER_ID, ADVENTURE_ID)).status).toBe(404);

    const disabled = setup({ env: { V3_ENABLED: undefined } });
    expect((await startPreview(disabled.deps, OWNER_ID, ADVENTURE_ID)).status).toBe(404);
  });

  it("returns not_ready for missing and invalid working specs", async () => {
    const missing = setup({ spec: null });
    expect(await startPreview(missing.deps, OWNER_ID, ADVENTURE_ID)).toMatchObject({
      status: 409,
      body: { error: { code: "not_ready", message: "This adventure has no story to preview yet." } },
    });

    const invalid = setup({ spec: {} });
    expect(await startPreview(invalid.deps, OWNER_ID, ADVENTURE_ID)).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "not_ready",
          message: "This adventure's story has errors to fix before it can be previewed.",
        },
      },
    });
  });

  it("round-trips a message and its post-turn check without persisting", async () => {
    const fixture = setup();
    const started = await startPreview(fixture.deps, OWNER_ID, ADVENTURE_ID);
    let { state, view } = previewBody(started);
    expect(view.phase).toBe("briefing");

    const afterBriefing = await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state,
      action: { type: "continue" },
    });
    expect(afterBriefing.status).toBe(200);
    ({ state, view } = previewBody(afterBriefing));
    if (view.phase === "stage" && view.stage?.intro) {
      const afterIntro = await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
        state,
        action: { type: "continue" },
      });
      expect(afterIntro.status).toBe(200);
      ({ state, view } = previewBody(afterIntro));
    }

    const character = view.characters[0];
    expect(character).toBeDefined();
    const messaged = await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state,
      action: { type: "message", characterId: character!.id, text: "What do you know?" },
    });
    expect(messaged.status).toBe(200);
    ({ state, view } = previewBody(messaged));
    const pending = pendingCheckIds(state);
    expect(pending).not.toHaveLength(0);
    expect(previewBody(messaged).pendingCheckIds).toEqual(pending);

    const checked = await previewCheck(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state,
      messageId: pending[0],
    });
    expect(checked.status).toBe(200);
    const checkedBody = previewBody(checked);
    expect(checkedBody.pendingCheckIds).toEqual([]);
    expect(pendingCheckIds(checkedBody.state)).toEqual([]);
    expect(checkedBody.view.pendingCheck).toBeFalsy();
    expect(await fixture.store.findLatestAttempt(ADVENTURE_ID, OWNER_ID)).toBeNull();
    expect(fixture.store.savedEvents).toEqual([]);
  });

  it("leaves state unchanged for an unknown post-turn message id", async () => {
    const fixture = setup();
    const started = previewBody(await startPreview(fixture.deps, OWNER_ID, ADVENTURE_ID));
    const checked = await previewCheck(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state: started.state,
      messageId: "unknown-message",
    });
    expect(checked.status).toBe(200);
    expect(previewBody(checked).state).toEqual(started.state);
    expect(previewBody(checked).view).toEqual(started.view);
  });

  it("returns a client error rather than throwing for a forged state", async () => {
    const fixture = setup();
    const result = await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state: { foo: 1 },
      action: { type: "continue" },
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it("rejects extra request fields", async () => {
    const fixture = setup();
    const state = previewBody(await startPreview(fixture.deps, OWNER_ID, ADVENTURE_ID)).state;
    expect(await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state,
      action: { type: "continue" },
      extra: true,
    })).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });
  });

  it("rate-limits preview actions per user", async () => {
    const fixture = setup({ env: { V3_RATE_LIMIT_PER_10S: "1" } });
    const state = previewBody(await startPreview(fixture.deps, OWNER_ID, ADVENTURE_ID)).state;
    const first = await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state,
      action: { type: "continue" },
    });
    expect(first.status).toBe(200);
    expect(await previewAction(fixture.deps, OWNER_ID, ADVENTURE_ID, {
      state: previewBody(first).state,
      action: { type: "continue" },
    })).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
  });
});
