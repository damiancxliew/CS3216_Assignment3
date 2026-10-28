import { publishedVersionId } from "../fixtures/v3-publication";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EngineSpec } from "@adventure/engine";
import { beforeAll, describe, expect, it } from "vitest";

import {
  loadJoinView,
  loadPublishState,
  publishAdventure,
  unpublishAdventure,
  type V3PublishDeps,
} from "@/lib/play/v3/publish";
import { finalCheckErrors } from "@/lib/v3/generation/check-errors";
import { createAttempt, type V3PlayServiceDeps } from "@/lib/play/v3/service";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";

const OWNER_ID = "teacher-owner";
const OTHER_TEACHER_ID = "other-teacher";
const ADMIN_ID = "school-admin";
const STUDENT_ID = "student";
const OUTSIDER_ID = "outsider";
const ADVENTURE_ID = "publish-adventure";
const SCHOOL_ID = "school-1";
let goldenSpec: ReturnType<typeof EngineSpec.parse>;

beforeAll(() => {
  goldenSpec = EngineSpec.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/golden-1819.json"), "utf8")));
});

function setup(options: { isPublic?: boolean; status?: string; spec?: unknown | null; env?: NodeJS.ProcessEnv } = {}) {
  const store = new MemoryV3PlayStore();
  store.addAdventure({
    id: ADVENTURE_ID,
    schoolId: SCHOOL_ID,
    ownerId: OWNER_ID,
    isPublic: options.isPublic,
    status: options.status ?? "draft",
    specVersion: 1,
    spec: options.spec === undefined ? goldenSpec : options.spec,
  });
  store.addMember(SCHOOL_ID, OWNER_ID);
  store.addMember(SCHOOL_ID, OTHER_TEACHER_ID);
  store.addMember(SCHOOL_ID, STUDENT_ID);
  store.addSchoolAdmin(SCHOOL_ID, ADMIN_ID);
  const env = { V3_ENABLED: "true", V3_SCHOOL_IDS: SCHOOL_ID, ...options.env };
  const deps: V3PublishDeps = { store, env };
  const playDeps: V3PlayServiceDeps = {
    store,
    env,
    now: () => 1_000,
    llm: () => {
      throw new Error("no LLM calls expected");
    },
  };
  return { store, deps, playDeps };
}

async function status(store: MemoryV3PlayStore) {
  return (await store.loadAdventure(ADVENTURE_ID))?.status;
}

describe("v3 publish", () => {
  it("opens public published links without sign-in or membership, but keeps staff controls private", async () => {
    const { deps } = setup({ isPublic: true, status: "published" });
    const versionId = await publishedVersionId(deps.store, ADVENTURE_ID);
    expect((await loadJoinView(deps, null, versionId)).kind).toBe("ready");
    expect((await loadJoinView(deps, OUTSIDER_ID, versionId)).kind).toBe("ready");
    // Bare adventure IDs and unknown versions stay closed even for public adventures.
    expect((await loadJoinView(deps, null, ADVENTURE_ID)).kind).toBe("closed");
    expect((await loadJoinView(deps, null, "forged-version")).kind).toBe("closed");
    expect((await publishAdventure(deps, OUTSIDER_ID, ADVENTURE_ID)).status).toBe(404);
    expect((await unpublishAdventure(deps, OUTSIDER_ID, ADVENTURE_ID)).status).toBe(404);
    for (const status of ["draft", "archived"]) {
      const closed = setup({ isPublic: true, status });
      expect((await loadJoinView(closed.deps, null, await publishedVersionId(closed.deps.store, ADVENTURE_ID))).kind).toBe("closed");
    }
  });

  it("lets the owner publish a generated draft, which opens it to students", async () => {
    const { store, deps, playDeps } = setup();
    expect((await createAttempt(playDeps, STUDENT_ID, await publishedVersionId(playDeps.store, ADVENTURE_ID))).status).toBe(404);

    const result = await publishAdventure(deps, OWNER_ID, ADVENTURE_ID);
    expect(result).toEqual({ status: 200, body: { status: "published" } });
    expect(await status(store)).toBe("published");
    expect((await createAttempt(playDeps, STUDENT_ID, await publishedVersionId(playDeps.store, ADVENTURE_ID))).status).toBe(201);
  });

  it("lets a school admin publish, but not another teacher or a student", async () => {
    const admin = setup();
    expect((await publishAdventure(admin.deps, ADMIN_ID, ADVENTURE_ID)).status).toBe(200);

    for (const userId of [OTHER_TEACHER_ID, STUDENT_ID, OUTSIDER_ID]) {
      const fixture = setup();
      expect((await publishAdventure(fixture.deps, userId, ADVENTURE_ID)).status).toBe(404);
      expect((await unpublishAdventure(fixture.deps, userId, ADVENTURE_ID)).status).toBe(404);
      expect(await status(fixture.store)).toBe("draft");
    }
  });

  it("refuses adventures that are still generating, awaiting review or failed", async () => {
    for (const current of ["briefing", "generating", "needs_review", "failed"]) {
      const { store, deps } = setup({ status: current });
      const result = await publishAdventure(deps, OWNER_ID, ADVENTURE_ID);
      expect(result.status).toBe(409);
      expect(await status(store)).toBe(current);
    }
  });

  it("refuses a missing or invalid spec", async () => {
    for (const spec of [null, { title: "Broken" }]) {
      const { store, deps } = setup({ spec });
      expect((await publishAdventure(deps, OWNER_ID, ADVENTURE_ID)).status).toBe(409);
      expect(await status(store)).toBe("draft");
    }
  });

  it("blocks final part errors even when the assembled spec passes checkSpec", async () => {
    const { store, deps } = setup();
    store.checkErrors.set(ADVENTURE_ID, finalCheckErrors({ partErrors: [{
      part: "persona:raffles", issue: { code: "quote-mismatch", path: "phrases.0", message: "Quote is not grounded" },
    }] }));
    expect((await publishAdventure(deps, OWNER_ID, ADVENTURE_ID)).status).toBe(409);
    expect(await status(store)).toBe("draft");
    expect(await loadPublishState(deps, OWNER_ID, ADVENTURE_ID)).toMatchObject({ kind: "unpublished", blockedReason: expect.any(String) });
  });

  it("ignores a retired school allowlist when publishing", async () => {
    const { store, deps } = setup({ env: { V3_SCHOOL_IDS: "another-school" } });
    expect((await publishAdventure(deps, OWNER_ID, ADVENTURE_ID)).status).toBe(200);
    expect(await loadPublishState(deps, OWNER_ID, ADVENTURE_ID)).toMatchObject({ kind: "published" });
    expect(await status(store)).toBe("published");
  });

  it("is idempotent and can be undone, republishing the archived adventure too", async () => {
    const { store, deps, playDeps } = setup({ status: "archived" });
    expect((await publishAdventure(deps, OWNER_ID, ADVENTURE_ID)).status).toBe(200);
    expect((await publishAdventure(deps, OWNER_ID, ADVENTURE_ID)).status).toBe(200);
    expect(await loadPublishState(deps, OWNER_ID, ADVENTURE_ID)).toMatchObject({ kind: "published", version: 1, publishedVersion: 1 });

    expect(await unpublishAdventure(deps, OWNER_ID, ADVENTURE_ID)).toEqual({ status: 200, body: { status: "draft" } });
    expect(await status(store)).toBe("draft");
    expect(await loadPublishState(deps, OWNER_ID, ADVENTURE_ID)).toMatchObject({ kind: "unpublished", status: "draft", version: 1, publishedVersion: null });
    expect((await createAttempt(playDeps, STUDENT_ID, await publishedVersionId(playDeps.store, ADVENTURE_ID))).status).toBe(409);
  });
});

describe("v3 student link", () => {
  it("opens a published adventure to members without v3 rollout configuration", async () => {
    const { deps } = setup({ status: "published", env: { V3_ENABLED: undefined, V3_SCHOOL_IDS: undefined } });
    expect(await loadJoinView(deps, STUDENT_ID, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "ready", title: goldenSpec.title });
    expect(await loadJoinView(deps, OUTSIDER_ID, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "not_member", title: goldenSpec.title });
  });

  it("is closed until the adventure is published", async () => {
    const { deps } = setup();
    expect(await loadJoinView(deps, null, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "closed" });
    expect(await loadJoinView(deps, STUDENT_ID, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "closed" });
    expect(await loadJoinView(deps, STUDENT_ID, "missing")).toEqual({ kind: "closed" });
  });

  it("asks signed-out visitors to sign in, and turns away non-members", async () => {
    const { deps } = setup({ status: "published" });
    expect(await loadJoinView(deps, null, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "sign_in", title: goldenSpec.title });
    expect(await loadJoinView(deps, OUTSIDER_ID, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "not_member", title: goldenSpec.title });
    expect(await loadJoinView(deps, STUDENT_ID, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "ready", title: goldenSpec.title });
  });

  it("opens published adventures regardless of a retired school allowlist", async () => {
    const { deps } = setup({ status: "published", env: { V3_SCHOOL_IDS: "another-school" } });
    expect(await loadJoinView(deps, STUDENT_ID, await publishedVersionId(deps.store, ADVENTURE_ID))).toEqual({ kind: "ready", title: goldenSpec.title });
  });
});
