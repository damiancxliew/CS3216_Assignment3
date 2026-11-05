import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "@adventure/generation";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";

const h = vi.hoisted(() => ({
  state: { adventureId: "00000000-0000-4000-8000-000000000001", draft: {}, messages: [], sources: [] } as BriefStateV3,
  documents: [] as ExtractedDocument[], authenticated: true, owned: true,
  failSave: false, failDocument: false, writes: 0,
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/jobs/runner", () => ({ getJobs: vi.fn(), kickTick: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/v3/generation/service", () => ({}));
vi.mock("@/lib/v3/brief/store", () => ({ supabaseV3BriefStore: vi.fn() }));
vi.mock("@/lib/v3/brief/service", () => ({
  requireStaff: async () => h.authenticated ? { userId: "teacher" } : { error: "not_found" },
  requireBriefingRow: async () => h.owned ? { row: { status: "briefing", state: structuredClone(h.state) }, store: { save: async (_id: string, state: BriefStateV3) => {
    if (h.failSave) throw Error("private database error");
    h.state = state;
  } } } : null,
  runV3BriefTurn: vi.fn(),
}));
vi.mock("@/lib/v3/generation/deps", () => ({ defaultGenerationDeps: () => ({ sources: {
  load: async () => h.documents,
  saveUploads: async (_id: string, uploads: { doc: ExtractedDocument }[]) => {
    if (h.failDocument) throw Error("private storage error");
    h.writes++;
    for (const { doc } of uploads) { h.documents = [...h.documents.filter((d) => d.id !== doc.id), doc]; }
  },
} }) }));
import { addV3BriefSource } from "@/app/v3/teacher/actions";

const token = "00000000-0000-4000-8000-000000000002";
function form(uploadId: string | null = token) {
  const data = new FormData();
  data.set("file", new File(["A merchant described the settlement in 1819."], "account.txt", { type: "text/plain" }));
  if (uploadId !== null) data.set("uploadId", uploadId);
  return data;
}
beforeEach(() => {
  h.state = { adventureId: "00000000-0000-4000-8000-000000000001", draft: {}, messages: [], sources: [] };
  h.documents = []; h.authenticated = true; h.owned = true; h.failSave = false; h.failDocument = false; h.writes = 0;
});
describe("brief upload queue boundary", () => {
  it("makes retries of the same token idempotent, including after a lost response", async () => {
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("ok", true);
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("ok", true);
    expect(h.state.sources.map((s) => s.id)).toEqual([`upload-${token}`]);
    expect(h.documents).toHaveLength(1);
    expect(h.writes).toBe(1);
  });
  it("recovers a saved document if saving the brief fails", async () => {
    h.failSave = true;
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("ok", false);
    expect(h.documents).toHaveLength(1);
    h.failSave = false;
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("ok", true);
    expect(h.state.sources).toHaveLength(1);
    expect(h.writes).toBe(1);
  });
  it("allows a partial-save retry to fill the twentieth slot", async () => {
    h.failSave = true;
    await addV3BriefSource(h.state.adventureId, form());
    h.failSave = false;
    h.state.sources.push(...Array.from({ length: 19 }, (_, i) => ({ id: `source-${i}`, title: "Source", kind: "text" as const })));
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("ok", true);
    expect(h.state.sources).toHaveLength(20);
    expect(h.writes).toBe(1);
  });
  it("makes pasted passage retries idempotent too", async () => {
    const data = new FormData();
    data.set("body", "A merchant described the settlement in 1819.");
    data.set("uploadId", token);
    await addV3BriefSource(h.state.adventureId, data);
    await addV3BriefSource(h.state.adventureId, data);
    expect(h.state.sources).toHaveLength(1);
    expect(h.writes).toBe(1);
  });
  it("does not merge distinct uploads with the same filename", async () => {
    await addV3BriefSource(h.state.adventureId, form());
    await addV3BriefSource(h.state.adventureId, form("00000000-0000-4000-8000-000000000003"));
    expect(h.state.sources).toHaveLength(2);
  });
  it("preserves legacy upload callers without tokens", async () => {
    await addV3BriefSource(h.state.adventureId, form(null));
    await addV3BriefSource(h.state.adventureId, form(null));
    expect(h.state.sources).toHaveLength(2);
    expect(new Set(h.state.sources.map((s) => s.id)).size).toBe(2);
  });
  it("rejects malformed tokens before writing source material", async () => {
    expect(await addV3BriefSource(h.state.adventureId, form("../../bad"))).toHaveProperty("error");
    expect(h.writes).toBe(0);
  });
  it("checks the 20-source cap before writing, while accepting known retries", async () => {
    await addV3BriefSource(h.state.adventureId, form());
    h.state.sources.push(...Array.from({ length: 19 }, (_, i) => ({ id: `source-${i}`, title: "Source", kind: "text" as const })));
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("ok", true);
    expect(await addV3BriefSource(h.state.adventureId, form("00000000-0000-4000-8000-000000000003"))).toHaveProperty("error");
    expect(h.writes).toBe(1);
  });
  it.each(["foreign", "unauthenticated"])("rejects %s requests before storing files", async (mode) => {
    if (mode === "foreign") h.owned = false;
    else h.authenticated = false;
    expect(await addV3BriefSource(h.state.adventureId, form())).toHaveProperty("error");
    expect(h.writes).toBe(0);
  });
  it("returns safe feedback when storage fails", async () => {
    h.failDocument = true;
    const result = await addV3BriefSource(h.state.adventureId, form());
    expect(result).toHaveProperty("ok", false);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each(["large", "unsupported"])("rejects %s files before storage", async (mode) => {
    const data = form();
    data.set("file", mode === "large" ? new File([new Uint8Array(15 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" }) : new File(["image"], "image.png", { type: "image/png" }));
    expect(await addV3BriefSource(h.state.adventureId, data)).toHaveProperty("error");
    expect(h.writes).toBe(0);
  });
});
