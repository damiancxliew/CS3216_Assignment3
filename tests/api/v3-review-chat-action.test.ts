import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import type { V3BriefRow } from "@/lib/v3/brief/store";
const harness = vi.hoisted(() => ({
  row: null as V3BriefRow | null,
  userId: "teacher",
  enabled: true,
  schoolAllowed: true,
  update: vi.fn(),
  completeJson: vi.fn(),
  conflict: false,
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
vi.mock("@/lib/v3/flag", () => ({
  v3Enabled: () => harness.enabled,
  v3SchoolAllowed: () => harness.schoolAllowed,
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
  };
});
import { suggestReviewChangeAction } from "@/app/v3/teacher/[id]/chat-actions";
const id = "00000000-0000-4000-8000-000000000226";
const input = { pass: "sources", removedSourceIds: [] };
beforeEach(() => {
  vi.stubEnv("V3_FAKE_PASSES", "1");
  harness.userId = "teacher";
  harness.enabled = true;
  harness.schoolAllowed = true;
  harness.conflict = false;
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
  harness.completeJson.mockResolvedValue({
    json: {
      notes: "I suggest excluding Extra.",
      changes: [{ path: ["sources", "1", "included"], value_json: "false" }],
    },
  });
});
describe("review chat access and persistence", () => {
  it.each(["owner", "school", "flag"])(
    "rejects a failed %s guard before a model call or write",
    async (guard) => {
      if (guard === "owner") harness.userId = "someone-else";
      if (guard === "school") harness.schoolAllowed = false;
      if (guard === "flag") harness.enabled = false;
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
});
