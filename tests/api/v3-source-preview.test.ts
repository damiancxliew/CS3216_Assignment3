import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  authenticated: true, role: "teacher", sysadmin: false, ownerId: "teacher", schoolId: "school",
  document: null as null | Record<string, unknown>, failed: false,
  filters: [] as [string, string][], selects: [] as string[],
}));
vi.mock("@/lib/v3/brief/service", () => ({ requireStaff: async () => h.authenticated ? {
  userId: "teacher", viewer: { user: { id: "teacher" }, membership: { role: h.role, organizationId: "school" }, isSysadmin: h.sysadmin },
} : { error: "not_found" } }));
vi.mock("@/lib/v3/brief/store", () => ({ supabaseV3BriefStore: () => ({ load: async () => ({ ownerId: h.ownerId, schoolId: h.schoolId }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const query = {
    select: (fields: string) => { h.selects.push(fields); return query; },
    eq: (column: string, value: string) => { h.filters.push([column, value]); return query; },
    maybeSingle: async () => ({ data: h.document, error: h.failed ? { message: "private error" } : null }),
  };
  return query;
} }) }));
import { previewBriefSource } from "@/app/v3/teacher/[id]/source-preview-actions";

const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  h.authenticated = true; h.role = "teacher"; h.sysadmin = false; h.ownerId = "teacher"; h.schoolId = "school";
  h.failed = false; h.filters = []; h.selects = [];
  h.document = { title: "Notes", kind: "pdf", origin: "upload", pages: [{ page: 3, text: "Original passage" }], storage_key: "private", content_hash: "secret" };
});
describe("brief source preview", () => {
  it("returns only the selected source's public fields and scopes the query to its adventure", async () => {
    expect(await previewBriefSource(id, "notes")).toEqual({ ok: true, source: { title: "Notes", kind: "pdf", origin: "upload", pages: [{ page: 3, text: "Original passage" }] } });
    expect(h.filters).toEqual([["adventure_id", id], ["source_key", "notes"]]);
    expect(h.selects).toEqual(["title, kind, origin, pages"]);
  });
  it.each(["unauthenticated", "foreign owner", "student", "foreign school admin"])("rejects %s without querying source text", async (scenario) => {
    if (scenario === "unauthenticated") h.authenticated = false;
    if (scenario === "foreign owner") h.ownerId = "other";
    if (scenario === "student") h.role = "student";
    if (scenario === "foreign school admin") { h.ownerId = "other"; h.role = "admin"; h.schoolId = "other-school"; }
    expect(await previewBriefSource(id, "notes")).toHaveProperty("error");
    expect(h.selects).toEqual([]);
  });
  it.each(["school admin", "sysadmin"])("matches authoring access for %s", async (scenario) => {
    h.ownerId = "other";
    if (scenario === "school admin") h.role = "admin";
    else h.sysadmin = true;
    expect(await previewBriefSource(id, "notes")).toHaveProperty("ok", true);
  });
  it("does not substitute another document for a source missing from this adventure", async () => {
    h.document = null;
    expect(await previewBriefSource(id, "foreign-source")).toHaveProperty("error");
    expect(h.filters).toContainEqual(["adventure_id", id]);
    expect(h.filters).toContainEqual(["source_key", "foreign-source"]);
  });
  it("handles failed reads without leaking details", async () => {
    h.failed = true;
    expect(await previewBriefSource(id, "notes")).toEqual({ ok: false, error: "Couldn’t load this source. Please try again." });
  });
  it("rejects malformed identifiers before querying text", async () => {
    expect(await previewBriefSource("bad", "notes")).toHaveProperty("error");
    expect(await previewBriefSource(id, "x".repeat(201))).toHaveProperty("error");
    expect(h.selects).toEqual([]);
  });
});
