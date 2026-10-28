import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { saveAdventureEdits } from "@/lib/v3/edit/service";
import { applyV3Edits, type V3Edit } from "@/lib/v3/edit/commands";
import { validateEditedSpec } from "@/lib/v3/edit/validation";

function setup() {
  const spec = AdventureSpec.parse(
    JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  );
  const store = new MemoryV3PlayStore();
  store.addAdventure({
    id: "a",
    ownerId: "teacher",
    schoolId: "s",
    status: "published",
    specVersion: 1,
    spec,
  });
  store.addMember("s", "teacher");
  const sources = [
    {
      id: "captured",
      title: "Captured",
      text: "The first paragraph.\n\nThe second paragraph.",
    },
  ];
  const deps = {
    store,
    env: {},
    sources: async () => sources,
    queueStageArt: async () => {},
  };
  const queueStageArt = vi.fn(deps.queueStageArt);
  deps.queueStageArt = queueStageArt;
  const save = (edits: V3Edit[], expected = 1) =>
    saveAdventureEdits(deps, "teacher", "a", expected, edits);
  return { spec, store, deps, sources, save, queueStageArt };
}

describe("direct editing", () => {
  it("opens and edits saved generation context containing stage IDs", async () => {
    const { spec, store, save } = setup();
    spec.authoring = {
      validationContext: {
        slantedDocuments: [{
          stageId: spec.stages[0].id,
          documentId: spec.documents[0].id,
          note: "Compare the account with other evidence.",
        }],
      },
    };
    store.addAdventure({ id: "a", ownerId: "teacher", schoolId: "s", status: "published", specVersion: 1, spec });
    expect(AdventureSpec.safeParse(spec).success).toBe(true);
    const result = await save([{ type: "set", path: ["title"], value: "Recovered adventure" }]);
    expect(result).toMatchObject({ ok: true, version: 2 });
    expect(AdventureSpec.safeParse((await store.loadAdventure("a"))!.spec).success).toBe(true);
    if (result.ok) expect(result.spec.authoring?.validationContext?.slantedDocuments[0].stageId).toBe(spec.stages[0].id);
  });
  it("persists generated validation context in a readable saved spec", async () => {
    const { spec, deps } = setup();
    const context = { slantedDocuments: [{ stageId: spec.stages[0].id, documentId: spec.documents[0].id, note: "Compare evidence." }] };
    const result = await saveAdventureEdits({ ...deps, validationContext: async () => context }, "teacher", "a", 1, [{ type: "set", path: ["title"], value: "Updated title" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(AdventureSpec.safeParse(result.spec).success).toBe(true);
      expect(result.spec.authoring?.validationContext).toEqual(context);
    }
  });
  it("refuses new semantic errors without writing or moving the live version", async () => {
    const { spec, store, save } = setup();
    const result = await save([
      { type: "set", path: ["stages", 0, "startRoomId"], value: "missing" },
    ]);
    expect(result).toMatchObject({ ok: false, code: "check-errors", errors: expect.arrayContaining([expect.objectContaining({ code: "ref" }),
      ]),
    });
    expect(await store.loadAdventure("a")).toMatchObject({ publishedVersion: 1, specVersion: 1, status: "published", spec,
    });
    expect(await store.loadVersionSpec("a", 1)).toEqual(spec);
  });
  it("makes no snapshot for a no-op and rejects stale/access/structurally invalid changes", async () => {
    const { save, deps, queueStageArt } = setup();
    expect(await save([])).toMatchObject({ ok: true, version: 1 });
    expect(queueStageArt).not.toHaveBeenCalled();
    expect(
      await save([{ type: "set", path: ["title"], value: "New title" }]),
    ).toMatchObject({ ok: true, version: 2 });
    expect(queueStageArt).not.toHaveBeenCalled();
    expect(await save([])).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await save(
        [{ type: "set", path: ["timer", "enabled"], value: "yes" }],
        2,
      ),
    ).toMatchObject({ ok: false, code: "invalid-edit" });
    expect(
      await saveAdventureEdits(deps, "outsider", "a", 2, []),
    ).toMatchObject({ ok: false, code: "access" });
  });
  it("saves story edits without starting paid stage-art generation", async () => {
    const { save, queueStageArt } = setup();
    queueStageArt.mockRejectedValueOnce(new Error("queue is unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(save([{ type: "set", path: ["title"], value: "New title" }]),
      )
        .resolves.toMatchObject({ ok: true, version: 2 });
      expect(queueStageArt).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
  it("attributes changed facts, clears obsolete citations and preserves unchanged evidence", async () => {
    const { spec, save } = setup();
    const result = await save([
      {
        type: "set",
        path: ["discoveries", 4, "text"],
        value: "A teacher contribution",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.discoveries[4]).toMatchObject({
      sourceLabel: "from the teacher",
      citations: [],
    });
    expect(result.spec.documents).toEqual(spec.documents);
    expect(result.spec.authoring?.teacherContributions).toContainEqual({
      entity: spec.discoveries[4].id,
      field: "text",
    });
  });
  it("protects real bodies through parent replacement and derives captured excerpts", async () => {
    const { spec, sources } = setup();
    spec.documents[0].real = true;
    const id = spec.documents[0].id;
    expect(() =>
      applyV3Edits(
        spec,
        [{ type: "set", path: ["documents", 0, "body"], value: "Fabricated" }],
        sources,
      ),
    ).toThrow(/Real document/);
    expect(() =>
      applyV3Edits(
        spec,
        [
          {
            type: "set",
            path: ["documents", 0],
            value: { ...spec.documents[0], body: "Fabricated" },
          },
        ],
        sources,
      ),
    ).toThrow(/Real document/);
    const replaced = applyV3Edits(
      spec,
      [
        {
          type: "replaceExcerpt",
          documentId: id,
          sourceId: "captured",
          start: 0,
          end: 20,
        },
      ],
      sources,
    );
    expect(replaced.documents[0]).toMatchObject({
      body: sources[0].text.slice(0, 20),
      keyPassages: [],
      citations: [
        { sourceId: "captured", quote: sources[0].text.slice(0, 20) },
      ],
    });
    expect(() =>
      applyV3Edits(
        spec,
        [
          {
            type: "replaceExcerpt",
            documentId: id,
            sourceId: "captured",
            start: 0,
            end: 20,
          },
          { type: "set", path: ["documents", 0, "body"], value: "Fabricated" },
        ],
        sources,
      ),
    ).toThrow(/Protected evidence/);
    const invented = applyV3Edits(
      spec,
      [
        { type: "convertDocument", documentId: id },
        {
          type: "set",
          path: ["documents", 0, "body"],
          value: "Invented prose",
        },
      ],
      sources,
    );
    expect(invented.documents[0]).toMatchObject({
      real: false,
      sourceLabel: "invented",
      body: "Invented prose",
      citations: [],
    });
  });
  it("supports recursive conditions, reorder and removal without changing existing IDs", () => {
    const { spec } = setup();
    const result = applyV3Edits(
      spec,
      [
        {
          type: "set",
          path: ["discoveries", 0, "condition"],
          value: {
            all: [
              { any: [{ discovered: spec.discoveries[1].id }] },
              { not: { elapsedAtLeast: 10 } },
            ],
          },
        },
        { type: "move", path: ["characters"], from: 0, to: 1 },
        { type: "insert", path: ["teacherQuestions"], index: 0, value: "Why?" },
      ],
      [],
    );
    expect(result.characters[1].id).toBe(spec.characters[0].id);
    expect(result.teacherQuestions[0]).toBe("Why?");
    expect(() =>
      applyV3Edits(
        spec,
        [{ type: "set", path: ["characters", 0, "id"], value: "renamed" }],
        [],
      ),
    ).toThrow();
  });
  it("retains unknown/contextual generation blockers; rechecks corrected constraints", async () => {
    const { spec, store, save } = setup();
    store.checkErrors.set("a", [
      {
        code: "slanted-document",
        path: "stage:s1/documents",
        message: "Missing slant context",
      },
      {
        code: "prediction-long",
        path: "moment:m1/outcomes.0.predictionText",
        message: "Too long",
      },
    ]);
    const result = await save([
      { type: "set", path: ["title"], value: "New title" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.errors.some((e) => e.code === "slanted-document")).toBe(true);
    expect(result.errors.some((e) => e.message === "Too long")).toBe(false);
    const bad = structuredClone(spec);
    bad.definingMoments[0].outcomes[0].predictionText = "word ".repeat(14);
    expect(
      validateEditedSpec(bad, []).errors.some(
        (e) => e.code === "prediction-long",
      ),
    ).toBe(true);
    expect(store.checkErrors.get("a")?.[1].message).toBe("Too long");
  });
  it("blocks verification when captured text is missing and checks source policy", () => {
    const { spec } = setup();
    spec.documents[0].real = true;
    spec.documents[0].citations = [{ sourceId: "gone", quote: "A quote" }];
    spec.authoring = { sourcePolicy: { allowAny: false } };
    spec.sources.push({
      id: "outside",
      title: "Outside",
      origin: "outside",
      url: "https://example.org/doc",
    });
    const errors = validateEditedSpec(spec, []).errors;
    expect(errors.some((e) => e.code === "source-unavailable")).toBe(true);
    expect(errors.some((e) => e.code === "source-policy")).toBe(true);
  });
});

it("rejects crafted source-operation bypasses and prototype paths", () => {
  const { spec, sources } = setup();
  const id = spec.documents[0].id;
  expect(() =>
    applyV3Edits(
      spec,
      [{ type: "set", path: ["__proto__", "polluted"], value: true }],
      sources,
    ),
  ).toThrow();
  expect(() =>
    applyV3Edits(
      spec,
      [
        { type: "convertDocument", documentId: id },
        {
          type: "set",
          path: ["documents", 0],
          value: { ...spec.documents[0], real: true, body: "Forged" },
        },
      ],
      sources,
    ),
  ).toThrow();
});

it("reuses portraits only for unchanged prompt inputs without generating assets", async () => {
  const { save, spec } = setup();
  const result = await save([
    { type: "set", path: ["discoveries", 4, "text"], value: "Teacher prose" },
  ]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(
    Object.values(result.spec.authoring!.portraitVersions!).every(
      (v) => v === 1,
    ),
  ).toBe(true);
  const second = setup();
  const changed = await second.save([
    {
      type: "set",
      path: ["characters", 0, "persona", "voice"],
      value: "Different voice",
    },
  ]);
  if (!changed.ok) throw Error(changed.message);
  const key = spec.characters[0].id;
  expect(
    Object.entries(changed.spec.authoring!.portraitVersions!)
      .filter(([id]) => id === key || id.startsWith(key + ":"))
      .every(([, v]) => v === null),
  ).toBe(true);
});

it('keeps a later invented conversion after an excerpt replacement', async () => {
  const { save, spec } = setup();
  const result = await save([
    { type: 'replaceExcerpt', documentId: spec.documents[0].id, sourceId: 'captured', start: 0, end: 20,
    },
    { type: 'convertDocument', documentId: spec.documents[0].id },
    { type: 'set', path: ['documents', 0, 'body'], value: 'Teacher invented prose',
    },
    { type: 'insert', path: ['documents', 0, 'keyPassages'], index: 0, value: { ...spec.documents[0].keyPassages[0], start: 0, end: 7 },
    },
  ]);
  if (!result.ok) throw Error(JSON.stringify(result));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.spec.documents[0]).toMatchObject({ real: false, sourceLabel: 'invented', citations: [], body: 'Teacher invented prose',
    });
});

it("adds no snapshot when an edit adds an empty required prose field", async () => {
  const { save, store } = setup();
  const write = vi.spyOn(store, "saveDraft");
  expect(await save([{ type: "set", path: ["definingMoments", 0, "nudge"], value: "" },
    ]),
  ).toMatchObject({ ok: false, code: "check-errors" });
  expect(write).not.toHaveBeenCalled();
});
