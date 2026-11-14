import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FakeDecisionClient } from "@adventure/generation/llm";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import type { V3BriefRow } from "@/lib/v3/brief/store";
const harness = vi.hoisted(() => ({
  row: null as V3BriefRow | null,
  userId: "teacher",
  update: vi.fn(),
  completeJson: vi.fn(),
  conflict: false,
  version: 1,
  role: "teacher",
  sysadmin: false,
  spec: null as unknown,
}));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => ({ user: { id: harness.userId }, membership: { role: harness.role, organizationId: "school" }, isSysadmin: harness.sysadmin }), isStaff: () => ["teacher", "admin"].includes(harness.role) }));
vi.mock("@/lib/play/v3/store", () => ({
  SupabaseV3PlayStore: class {
    async loadAdventure() {
      return {
        status: harness.row!.status,
        specVersion: harness.version,
        spec: harness.spec ?? JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
      };
    }
    async loadCheckErrors() { return []; }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: harness.userId } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (value: unknown) => {
        harness.update(value);
        const query = {
          eq: () => query,
          select: async () => ({
            data: harness.conflict ? [] : [{ id: harness.row!.id }],
            error: null,
          }),
        };
        return query;
      },
    }),
  }),
}));
vi.mock("@/lib/v3/brief/store", () => ({
  supabaseV3BriefStore: () => ({
    load: async () => structuredClone(harness.row),
  }),
}));

vi.mock("@adventure/jobs", () => ({ supabaseJobStore: () => ({}) }));
vi.mock("@/lib/v3/generation/deps", () => ({
  defaultGenerationDeps: () => ({ sources: { load: async () => [] } }),
}));
vi.mock("@/lib/v3/generation/service", () => ({
  requirePause: async () =>
    harness.row?.status === "needs_review" ? harness.row : null,
  loadPause: async () => ({
    pass: "sources",
    index: 1,
    uploads: [{ id: "upload", title: "Upload" }],
    outside: [{ id: "outside", title: "Extra", url: "https://example.org" }],
    rejected: [],
  }),
}));
vi.mock("@/lib/v3/review-chat/propose", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v3/review-chat/propose")>();
  return {
    ...actual,
    fakeRequestedEditor: () => ({ completeJson: harness.completeJson }),
    fakeTargetedEditor: () => ({ completeJson: harness.completeJson }),
    fakeReviewQuestionAnswerer: () => ({ completeJson: harness.completeJson }),
  };
});
import {
  findEditTargetsAction,
  suggestReviewChangeAction,
} from "@/app/v3/teacher/[id]/chat-actions";
const id = "00000000-0000-4000-8000-000000000226";
const input = { pass: "sources", removedSourceIds: [] };
const draftInput = { pass: "draft", version: 1, edits: [] };
beforeEach(() => {
  harness.role = "teacher"; harness.sysadmin = false;
  vi.stubEnv("V3_FAKE_PASSES", "1");
  harness.userId = "teacher";

  harness.conflict = false;
  harness.version = 1;
  harness.row = {
    id,
    ownerId: "teacher",
    schoolId: "school",
    status: "needs_review",
    title: "A story",
    updatedAt: "2026-10-20T00:00:00Z",
    state: initialBriefStateV3(id),
  };
  harness.update.mockReset();
  harness.completeJson.mockReset();
  harness.spec = null;
  harness.completeJson.mockResolvedValue({
    json: {
      notes: "I suggest excluding Extra.",
      changes: [{ path: ["sources", "1", "included"], value_json: "false" }],
    },
  });
});
describe("review chat access and persistence", () => {
  it.each(["admin", "system-admin"])("allows %s to request edits to another teacher's saved draft", async (role) => {
    harness.userId = "another-user";
    harness.role = role === "admin" ? "admin" : "teacher";
    harness.sysadmin = role === "system-admin";
    harness.row!.status = "draft";
    harness.completeJson.mockResolvedValue({ json: { notes: "No changes needed.", changes: [] } });
    const result = await suggestReviewChangeAction(id, { pass: "draft", version: 1, edits: [] }, "Check the title");
    expect(result.ok).toBe(true);
    expect(harness.update).toHaveBeenCalled();
  });
  it.each(["draft", "published", "archived"] as const)(
    "proposes changes to a saved %s adventure without saving or publishing the spec",
    async (status) => {
      harness.row!.status = status;
      harness.completeJson.mockResolvedValue({ json: {
        notes: "I suggest a new title.",
        changes: [{ path: ["title"], value_json: '"A revised adventure"' }],
      } });
      const result = await suggestReviewChangeAction(id, {
        pass: "draft", version: 1,
        edits: [{ type: "set", path: ["title"], value: "My local title" }],
      }, "Change the title");
      expect(result).toMatchObject({
        ok: true,
        preview: [{ before: "My local title", after: "A revised adventure" }],
        proposal: { pass: "draft", edits: [
          { type: "set", path: ["title"], value: "My local title" },
          { type: "set", path: ["title"], value: "A revised adventure" },
        ] },
      });
      expect(Object.keys(harness.update.mock.calls[0][0])).toEqual(["brief_state"]);
    },
  );
  it("rejects a stale saved version before calling the model", async () => {
    harness.row!.status = "published";
    expect(await suggestReviewChangeAction(id, { pass: "draft", version: 0, edits: [] }, "Change the title"))
      .toMatchObject({ ok: false });
    expect(harness.completeJson).not.toHaveBeenCalled();
  });
  it("drops a saved-adventure suggestion if its version changes during the request", async () => {
    harness.row!.status = "published";
    harness.completeJson.mockImplementation(async () => {
      harness.version++;
      return { json: { notes: "No changes needed", changes: [] } };
    });
    expect(await suggestReviewChangeAction(id, { pass: "draft", version: 1, edits: [] }, "Change the title"))
      .toMatchObject({ ok: false });
    expect(harness.update).not.toHaveBeenCalled();
  });
  it.each(["owner"])(
    "rejects a failed %s guard before a model call or write",
    async (guard) => {
      if (guard === "owner") harness.userId = "someone-else";
      expect(
        await suggestReviewChangeAction(id, input, "Exclude Extra"),
      ).toMatchObject({ ok: false });
      expect(harness.completeJson).not.toHaveBeenCalled();
      expect(harness.update).not.toHaveBeenCalled();
    },
  );
  it("saves the conversation but only proposes a selection change", async () => {
    const result = await suggestReviewChangeAction(id, input, "Exclude Extra");
    expect(result).toMatchObject({
      ok: true,
      proposal: { pass: "sources", removedSourceIds: ["outside"] },
      preview: [{ before: "Included", after: "Not included" }],
    });
    expect(harness.update).toHaveBeenCalledWith({
      brief_state: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", text: "Exclude Extra" }),
          expect.objectContaining({ role: "assistant", slot: "review" }),
        ]),
      }),
    });
    expect(Object.keys(harness.update.mock.calls[0][0])).toEqual([
      "brief_state",
    ]);
  });
  it("does not return a proposal after the review advances", async () => {
    harness.completeJson.mockImplementation(async () => {
      harness.row!.status = "generating";
      return { json: { notes: "A selection", changes: [] } };
    });
    expect(
      await suggestReviewChangeAction(id, input, "Exclude Extra"),
    ).toMatchObject({ ok: false });
    expect(harness.update).not.toHaveBeenCalled();
  });
  it("does not overwrite another chat tab's conversation", async () => {
    harness.completeJson.mockImplementation(async () => {
      harness.row!.state!.messages.push({
        role: "user",
        text: "Another tab",
        slot: "review",
      });
      return { json: { notes: "A selection", changes: [] } };
    });
    expect(
      await suggestReviewChangeAction(id, input, "Exclude Extra"),
    ).toMatchObject({ ok: false });
    expect(harness.update).not.toHaveBeenCalled();
  });
  it("does not offer a suggestion when the conversation checkpoint loses a race", async () => {
    harness.conflict = true;
    expect(
      await suggestReviewChangeAction(id, input, "Exclude Extra"),
    ).toMatchObject({ ok: false });
  });
  it("refuses to deselect an upload", async () => {
    harness.completeJson.mockResolvedValue({
      json: {
        notes: "Remove upload",
        changes: [{ path: ["sources", "0", "included"], value_json: "false" }],
      },
    });
    expect(
      await suggestReviewChangeAction(id, input, "Remove upload"),
    ).toMatchObject({ ok: false });
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("finds draft edit targets without persisting target discovery", async () => {
    harness.row!.status = "draft";
    const result = await findEditTargetsAction(
      id,
      draftInput,
      "Change the adventure title",
    );

    expect(result).toMatchObject({
      ok: true,
      intent: "change",
      targets: expect.arrayContaining([
        expect.objectContaining({ path: ["title"], selected: true }),
      ]),
    });
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("passes the last four persisted review messages into target decisions", async () => {
    harness.row!.status = "draft";
    harness.row!.state!.messages = [
      { role: "user", text: "Old question", slot: "review" },
      { role: "assistant", text: "Old answer", slot: "review" },
      { role: "user", text: "Recent question", slot: "review" },
      { role: "assistant", text: "Recent answer", slot: "review" },
      { role: "user", text: "Can we revise that?", slot: "review" },
      { role: "assistant", text: "You could ask me to make it shorter.", slot: "review" },
    ];
    const decide = vi.spyOn(FakeDecisionClient.prototype, "decide");
    try {
      await findEditTargetsAction(id, draftInput, "Yes, do that.");
      expect(decide).toHaveBeenCalledTimes(3);
      const input = decide.mock.calls[0]![0].input as {
        content: { type: string; text?: string }[];
      }[];
      expect(input[0]!.content[0]!.text).toBe(
        "Earlier conversation:\nTeacher: Recent question\nAssistant: Recent answer\nTeacher: Can we revise that?\nAssistant: You could ask me to make it shorter.",
      );
      expect(input[0]!.content[0]!.text).not.toContain("Old question");
      expect(input[0]!.content[1]!.text).toBe("Teacher's message: Yes, do that.");
      expect(input[0]!.content.some(({ type }) => type === "input_json")).toBe(false);
    } finally {
      decide.mockRestore();
    }
  });

  it("persists the targeted draft request with its field labels", async () => {
    harness.row!.status = "draft";
    harness.completeJson.mockResolvedValue({
      json: {
        notes: "I revised the title.",
        changes: [{ target: "t0", text: "A revised title" }],
        passages: [],
      },
    });
    const text = "Change the title to “A revised title”";
    const result = await suggestReviewChangeAction(
      id,
      draftInput,
      text,
      [["title"]],
    );

    expect(result).toMatchObject({
      ok: true,
      preview: [{ after: "A revised title" }],
    });
    expect(harness.update).toHaveBeenCalledWith({
      brief_state: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            text: `${text}\n\nTargets: Adventure title`,
          }),
        ]),
      }),
    });
  });

  it("persists a reply without a proposal", async () => {
    harness.row!.status = "draft";
    harness.completeJson.mockResolvedValue({
      json: { reply: "Percival leads the expedition." },
    });
    const result = await suggestReviewChangeAction(
      id,
      draftInput,
      "Who leads the expedition?",
      undefined,
      "reply",
    );

    expect(result).toMatchObject({
      ok: true,
      preview: [],
      proposal: null,
      notes: "Percival leads the expedition.",
    });
    expect(harness.update).toHaveBeenCalledWith({
      brief_state: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            text: "Who leads the expedition?",
          }),
          expect.objectContaining({
            role: "assistant",
            text: "Percival leads the expedition.",
            slot: "review",
          }),
        ]),
      }),
    });
  });

  it("rejects reply mode when a target list is supplied", async () => {
    harness.row!.status = "draft";

    await expect(suggestReviewChangeAction(
      id,
      draftInput,
      "Who leads the expedition?",
      [["title"]],
      "reply",
    )).resolves.toEqual({
      ok: false,
      message: "A reply cannot target fields.",
    });
    expect(harness.completeJson).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("offsets targeted group edit indices past existing draft edits", async () => {
    harness.row!.status = "draft";
    harness.completeJson.mockResolvedValue({
      json: {
        notes: "I revised the title.",
        changes: [{ target: "t0", text: "A revised title" }],
        passages: [],
      },
    });
    const result = await suggestReviewChangeAction(
      id,
      {
        ...draftInput,
        edits: [{ type: "set", path: ["title"], value: "My local title" }],
      },
      "Change the title",
      [["title"]],
    );

    expect(result).toMatchObject({
      ok: true,
      groups: [{ edits: [1], preview: [0] }],
      proposal: {
        pass: "draft",
        edits: [
          { type: "set", path: ["title"], value: "My local title" },
          { type: "set", path: ["title"], value: "A revised title" },
        ],
      },
    });
  });

  it("rejects missing, protected, and real-document body targets before writing", async () => {
    harness.row!.status = "draft";
    const spec = JSON.parse(
      readFileSync("fixtures/golden-1819.json", "utf8"),
    ) as {
      documents: { real: boolean; sourceLabel: string }[];
      [key: string]: unknown;
    };
    spec.documents[0]!.real = true;
    harness.spec = spec;
    for (const path of [
      ["notAnItem"],
      ["documents", 0, "sourceLabel"],
      ["documents", 0, "body"],
    ]) {
      expect(
        await suggestReviewChangeAction(id, draftInput, "Change this", [path]),
      ).toEqual({
        ok: false,
        message: "One of the selected fields can no longer be changed. Find targets again.",
      });
    }
    expect(harness.completeJson).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });
});
