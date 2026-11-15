import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EngineSpec } from "@adventure/engine";
import type { GameEvent } from "@adventure/play-contract";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { loadClassSummary } from "@/lib/play/v3/summary";
import { MemoryV3PlayStore, SupabaseV3PlayStore } from "@/lib/play/v3/store";

const OWNER_ID = "teacher-owner";
const OTHER_USER_ID = "other-teacher";
const SCHOOL_ADMIN_ID = "school-admin";
const PLATFORM_ADMIN_ID = "platform-admin";
const ADVENTURE_ID = "summary-adventure";
const SCHOOL_ID = "school-1";
const GOLDEN_SOURCE = resolve(process.cwd(), "fixtures/golden-1819.json");
let goldenSpec: ReturnType<typeof EngineSpec.parse>;

beforeAll(() => {
  goldenSpec = EngineSpec.parse(
    JSON.parse(readFileSync(GOLDEN_SOURCE, "utf8")),
  );
});

function setup(
  options: {
    ownerId?: string;
    schoolId?: string;
    specVersion?: number;
    spec?: unknown | null;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const store = new MemoryV3PlayStore();
  store.addAdventure({
    id: ADVENTURE_ID,
    schoolId: options.schoolId ?? SCHOOL_ID,
    ownerId: options.ownerId ?? OWNER_ID,
    status: "published",
    specVersion: options.specVersion ?? 1,
    spec: options.spec === undefined ? goldenSpec : options.spec,
  });
  const deps = {
    store,
    env: { ...options.env },
  };
  return { store, deps };
}

function eventsFor(
  options: { flag?: boolean; finalVerdict?: boolean; completed?: boolean } = {},
): GameEvent[] {
  const discovery = goldenSpec.discoveries[0]!;
  const moment = goldenSpec.definingMoments[0]!;
  const ending = goldenSpec.endings[0]!;
  const noteId = `note-${discovery.id}`;
  const initialVerdict = ending.interview.verdicts[0]!;
  const finalVerdict =
    ending.interview.verdicts.find(
      (verdict) => verdict.id !== initialVerdict.id,
    ) ?? initialVerdict;
  const outcome = moment.outcomes[0]!;
  const events: GameEvent[] = [
    {
      type: "hint",
      at: 1,
      stageIndex: 0,
      level: 1,
      targetDiscoveryId: discovery.id,
    },
    {
      type: "prediction",
      at: 2,
      stageIndex: 0,
      momentId: moment.id,
      outcomeId: outcome.id,
    },
    {
      type: "discovery",
      at: 3,
      stageIndex: 0,
      discoveryId: discovery.id,
      noteId,
      core: discovery.core,
      via: "conversation",
    },
    {
      type: "verdict",
      at: 4,
      stageIndex: 0,
      endingId: ending.id,
      verdictId: initialVerdict.id,
      evidenceNoteIds: [noteId],
      stage: "initial",
      text: "The first answer.",
    },
  ];
  if (options.finalVerdict) {
    events.push({
      type: "verdict",
      at: 5,
      stageIndex: 0,
      endingId: ending.id,
      verdictId: finalVerdict.id,
      evidenceNoteIds: [noteId],
      stage: "final",
      text: "The answer after push-back.",
    });
  }
  events.push({
    type: "outcome",
    at: 6,
    stageIndex: 0,
    momentId: moment.id,
    outcomeId: outcome.id,
    endingId: ending.id,
    closedEndingIds: [],
  });
  if (options.completed)
    events.push({ type: "phase", at: 7, stageIndex: 0, to: "reveal" });
  if (options.flag) {
    events.push({
      type: "flag",
      at: 8,
      stageIndex: 0,
      messageId: "flagged-message",
      category: "provocative",
      reason: "Follow up with this student.",
    });
  }
  return events;
}

describe("v3 class summary service", () => {
  it("allows the owner, a school admin, and a platform admin", async () => {
    const owner = setup();
    expect(
      (await loadClassSummary(owner.deps, OWNER_ID, ADVENTURE_ID)).status,
    ).toBe(200);

    const schoolAdmin = setup();
    schoolAdmin.store.addSchoolAdmin(SCHOOL_ID, SCHOOL_ADMIN_ID);
    expect(
      (await loadClassSummary(schoolAdmin.deps, SCHOOL_ADMIN_ID, ADVENTURE_ID))
        .status,
    ).toBe(200);

    const platformAdmin = setup();
    platformAdmin.store.addPlatformAdmin(PLATFORM_ADMIN_ID);
    expect(
      (
        await loadClassSummary(
          platformAdmin.deps,
          PLATFORM_ADMIN_ID,
          ADVENTURE_ID,
        )
      ).status,
    ).toBe(200);
  });

  it("returns 404 for non-admin members, outsiders and unknown adventures", async () => {
    const fixture = setup();
    fixture.store.addMember(SCHOOL_ID, OTHER_USER_ID, true);
    expect(
      (await loadClassSummary(fixture.deps, OTHER_USER_ID, ADVENTURE_ID))
        .status,
    ).toBe(404);
    expect(
      (await loadClassSummary(fixture.deps, "outsider", ADVENTURE_ID)).status,
    ).toBe(404);
    expect(
      (await loadClassSummary(fixture.deps, OWNER_ID, "unknown-adventure"))
        .status,
    ).toBe(404);

  });

  it("returns not_published before loading results for an unpublished adventure", async () => {
    const fixture = setup({ specVersion: 0 });
    expect(
      await loadClassSummary(fixture.deps, OWNER_ID, ADVENTURE_ID),
    ).toMatchObject({
      status: 409,
      code: "not_published",
      title: goldenSpec.title,
    });
  });

  it("logs and hides missing or invalid published specs", async () => {
    const logger = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const missing = setup({ spec: null });
      expect(
        (await loadClassSummary(missing.deps, OWNER_ID, ADVENTURE_ID)).status,
      ).toBe(404);

      const invalid = setup({ spec: {} });
      expect(
        (await loadClassSummary(invalid.deps, OWNER_ID, ADVENTURE_ID)).status,
      ).toBe(404);
      expect(logger).toHaveBeenCalledTimes(2);
    } finally {
      logger.mockRestore();
    }
  });

  it("summarises class events and names only students with flagged messages", async () => {
    const fixture = setup();
    fixture.store.setStudentEmail("flagged-student", "flagged@example.test");
    fixture.store.setStudentEmail(
      "unflagged-student",
      "unflagged@example.test",
    );
    const flaggedAttemptId = fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "flagged-student",
      events: eventsFor({ flag: true, finalVerdict: true, completed: true }),
    });
    fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "unflagged-student",
      events: eventsFor(),
    });
    const lookup = vi.spyOn(fixture.store, "studentEmail");
    const listFlags = vi.spyOn(fixture.store, "listFlags");

    const result = await loadClassSummary(fixture.deps, OWNER_ID, ADVENTURE_ID);
    expect(result.status).toBe(200);
    if (result.status !== 200) return;

    expect(result.summary).toMatchObject({
      attempts: 2,
      completed: 1,
      flags: [{ attemptId: flaggedAttemptId, count: 1 }],
    });
    expect(result.summary.verdicts[0]?.changedAfterPushBack).toBe(1);
    expect(result.flagged).toEqual([
      {
        attemptId: flaggedAttemptId,
        count: 1,
        student: "flagged@example.test",
        severity: "review",
        messages: [],
      },
    ]);
    expect(lookup.mock.calls).toEqual([["flagged-student"]]);
    expect(listFlags).toHaveBeenCalledWith([flaggedAttemptId]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("unflagged-student");
    expect(serialized).not.toContain("unflagged@example.test");
  });

  it("returns stored flag details with severity and matching character names", async () => {
    const fixture = setup();
    const attemptId = fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "flagged-student",
      events: eventsFor({ flag: true }),
    });
    fixture.store.addFlag({
      attemptId,
      messageId: "flagged-message",
      category: "provocative",
      excerpt: "A proposed act.",
      characterId: "temenggong",
      stageIndex: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await loadClassSummary(fixture.deps, OWNER_ID, ADVENTURE_ID);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.flagged[0]).toEqual({
      attemptId,
      count: 1,
      student: "Student flagged-",
      severity: "review",
      messages: [
        {
          messageId: "flagged-message",
          category: "provocative",
          severity: "review",
          excerpt: "A proposed act.",
          characterName: goldenSpec.characters.find((character) => character.id === "temenggong")?.name ?? null,
          stageIndex: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("sorts urgent flagged students before students with only review flags", async () => {
    const fixture = setup();
    const provocativeAttemptId = fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "z-student",
      events: eventsFor({ flag: true }),
    });
    const threatEvents = eventsFor({ flag: true }).map((event) =>
      event.type === "flag" ? { ...event, category: "threat" as const } : event,
    );
    const threatAttemptId = fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "a-student",
      events: threatEvents,
    });
    fixture.store.setStudentEmail("z-student", "z@example.test");
    fixture.store.setStudentEmail("a-student", "a@example.test");

    const result = await loadClassSummary(fixture.deps, OWNER_ID, ADVENTURE_ID);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.flagged.map(({ attemptId, severity }) => ({ attemptId, severity }))).toEqual([
      { attemptId: threatAttemptId, severity: "urgent" },
      { attemptId: provocativeAttemptId, severity: "review" },
    ]);
  });

  it("uses an opaque label when a flagged student's email is unavailable", async () => {
    const fixture = setup();
    fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "flagged-student",
      events: eventsFor({ flag: true }),
    });

    const result = await loadClassSummary(fixture.deps, OWNER_ID, ADVENTURE_ID);
    expect(result).toMatchObject({
      status: 200,
      flagged: [{ student: "Student flagged-" }],
    });
  });

  it("selects the requested version when present and otherwise falls back to current", async () => {
    const fixture = setup({ specVersion: 2 });
    fixture.store.addVersionSpec(ADVENTURE_ID, 1, goldenSpec);
    fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 1,
      studentId: "student-v1",
      events: eventsFor(),
    });
    fixture.store.addAttemptWithEvents({
      adventureId: ADVENTURE_ID,
      specVersion: 2,
      studentId: "student-v2",
      events: eventsFor(),
    });

    const current = await loadClassSummary(
      fixture.deps,
      OWNER_ID,
      ADVENTURE_ID,
    );
    const requested = await loadClassSummary(
      fixture.deps,
      OWNER_ID,
      ADVENTURE_ID,
      1,
    );
    const unknown = await loadClassSummary(
      fixture.deps,
      OWNER_ID,
      ADVENTURE_ID,
      9,
    );
    expect(current).toMatchObject({
      status: 200,
      version: 2,
      summary: { attempts: 1 },
      versions: [
        { version: 2, attempts: 1 },
        { version: 1, attempts: 1 },
      ],
    });
    expect(requested).toMatchObject({
      status: 200,
      version: 1,
      summary: { attempts: 1 },
    });
    expect(unknown).toMatchObject({
      status: 200,
      version: 2,
      summary: { attempts: 1 },
    });
  });
});

describe("Supabase v3 event loading", () => {
  it("paginates at 1,000 events and warns once when an event is invalid", async () => {
    const attemptId = "attempt-1";
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      attempt_id: attemptId,
      seq: index + 1,
      type: index === 1_000 ? "invalid" : "hint",
      payload: {
        at: index,
        stageIndex: 0,
        level: 1,
        targetDiscoveryId: "discovery-1",
      },
    }));
    const ranges: [number, number][] = [];
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(async (from: number, to: number) => {
        ranges.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      }),
    };
    const admin = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient;
    const logger = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const events = await new SupabaseV3PlayStore(admin).loadEvents([
        attemptId,
      ]);
      expect(events.get(attemptId)).toHaveLength(1_000);
      expect(ranges).toEqual([
        [0, 999],
        [1_000, 1_999],
      ]);
      expect(logger).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledWith(expect.stringContaining("1 invalid"));
    } finally {
      logger.mockRestore();
    }
  });
});

describe("Supabase v3 flag loading", () => {
  it("chunks attempt IDs and defensively maps details in creation order", async () => {
    const attemptIds = Array.from({ length: 101 }, (_, index) => `attempt-${index}`);
    const chunks: string[][] = [];
    const orders: { column: string; options: { ascending: boolean } }[] = [];
    let activeChunk: string[] = [];
    const rows = [
      {
        attempt_id: "attempt-0",
        message_id: "message-later",
        category: "threat",
        excerpt: "A threat",
        result: { characterId: "temenggong", stageIndex: 2 },
        created_at: "2026-01-02T00:00:00.000Z",
      },
      {
        attempt_id: "attempt-100",
        message_id: "message-earlier",
        category: "provocative",
        excerpt: "A proposal",
        result: { characterId: 4, stageIndex: "1" },
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const query = {
      select: vi.fn(() => query),
      in: vi.fn((_column: string, values: string[]) => {
        activeChunk = values;
        chunks.push([...values]);
        return query;
      }),
      order: vi.fn((column: string, options: { ascending: boolean }) => {
        orders.push({ column, options });
        return query;
      }),
      range: vi.fn(async () => ({
        data: rows.filter((row) => activeChunk.includes(row.attempt_id)),
        error: null,
      })),
    };
    const admin = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    const flags = await new SupabaseV3PlayStore(admin).listFlags(attemptIds);

    expect(query.select).toHaveBeenCalledWith(
      "attempt_id, message_id, category, excerpt, result, created_at",
    );
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 1]);
    expect(orders).toEqual([
      { column: "created_at", options: { ascending: true } },
      { column: "created_at", options: { ascending: true } },
    ]);
    expect(flags).toEqual([
      {
        attemptId: "attempt-100",
        messageId: "message-earlier",
        category: "provocative",
        excerpt: "A proposal",
        characterId: null,
        stageIndex: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        attemptId: "attempt-0",
        messageId: "message-later",
        category: "threat",
        excerpt: "A threat",
        characterId: "temenggong",
        stageIndex: 2,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });
});

it("shows an explicitly requested saved draft with zero attempts instead of another version’s results", async () => {
  const { store, deps } = setup();
  await store.publishVersion(ADVENTURE_ID, 1, 1, true);
  await store.saveDraft(ADVENTURE_ID, 1, { ...goldenSpec, title: "Unpublished update" });
  const result = await loadClassSummary(deps, OWNER_ID, ADVENTURE_ID, 2);
  expect(result).toMatchObject({ status: 200, version: 2, title: "Unpublished update" });
  if (result.status === 200) expect(result.versions).toContainEqual({ version: 2, attempts: 0 });
});

it("defaults to the live release and excludes newer unpublished drafts from results", async () => {
  const fixture = setup();
  await fixture.store.publishVersion(ADVENTURE_ID, 1, 1, true);
  await fixture.store.saveDraft(ADVENTURE_ID, 1, {
    ...goldenSpec,
    title: "Unpublished teacher draft",
  });
  expect(
    await loadClassSummary(fixture.deps, OWNER_ID, ADVENTURE_ID),
  ).toMatchObject({
    status: 200,
    version: 1,
    title: goldenSpec.title,
    versions: [{ version: 1, attempts: 0 }],
  });
});
