import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: { userId: "teacher", schoolId: "school" } as { userId: string; schoolId: string } | { error: string },
  allowed: true,
  row: null as Record<string, unknown> | null,
  inserts: [] as { table: string; value: unknown }[],
  deleted: [] as string[],
  failSources: false,
}));
vi.mock("@/lib/v3/brief/service", () => ({ requireStaff: async () => h.auth }));
vi.mock("@/lib/v3/flag", () => ({ v3SchoolAllowed: () => h.allowed }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`redirect:${url}`); } }));
vi.mock("@/lib/v3/generation/deps", () => ({ supabaseV3SourceStore: () => ({ load: async () => [] }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from(table: string) {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: h.row, error: null }),
      single: async () => ({ data: { id: "new-copy" }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: table === "sources_v3" && h.failSources ? { message: "failed" } : null }).then(resolve),
    };
    return {
      ...query,
      insert(value: unknown) { h.inserts.push({ table, value }); return query; },
      delete() { h.deleted.push(table); return query; },
    };
  },
}) }));

import { importAdventureJson } from "@/app/v3/teacher/import-actions";
import { GET } from "@/app/api/v3/adventures/[id]/export/route";
const spec = JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8"));
const form = (content: string) => {
  const data = new FormData();
  data.set("file", new File([content], "adventure.json", { type: "application/json" }));
  return data;
};
const request = () => GET(new Request("http://localhost/api/v3/adventures/story/export"), { params: Promise.resolve({ id: "story" }) });
beforeEach(() => {
  h.auth = { userId: "teacher", schoolId: "school" };
  h.allowed = true; h.inserts = []; h.deleted = []; h.failSources = false;
  h.row = { owner_id: "teacher", school_id: "school", status: "draft", spec, spec_version: 2 };
});

describe("v3 import/export access and persistence", () => {
  it("creates an unpublished copy owned by the signed-in teacher", async () => {
    await expect(importAdventureJson({}, form(JSON.stringify(spec)))).rejects.toThrow("redirect:/v3/teacher/new-copy?view=editor");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({ table: "adventures_v3", value: { school_id: "school", owner_id: "teacher", status: "draft", title: spec.title, spec: { title: spec.title } } });
  });

  it("saves source pages with the new adventure", async () => {
    const sources = [{ id: "reading", title: "Reading", kind: "text", pages: [{ page: 1, text: "Source contents" }] }];
    await expect(importAdventureJson({}, form(JSON.stringify({ format: "pocket-adventure-v3", version: 1, spec, sources })))).rejects.toThrow("redirect:");
    expect(h.inserts[1]).toMatchObject({ table: "sources_v3", value: [{ adventure_id: "new-copy", source_key: "reading", pages: sources[0].pages }] });
  });

  it("removes the new draft when source persistence fails", async () => {
    h.failSources = true;
    const result = await importAdventureJson({}, form(JSON.stringify({ format: "pocket-adventure-v3", version: 1, spec, sources: [{ id: "reading", title: "Reading", kind: "text", pages: [] }] })));
    expect(result.error).toContain("Could not import source text");
    expect(h.deleted).toEqual(["adventures_v3"]);
  });

  it("rejects invalid JSON without writing", async () => {
    expect((await importAdventureJson({}, form("{broken"))).error).toContain("not valid JSON");
    expect(h.inserts).toEqual([]);
  });

  it.each(["unsigned", "school-blocked"])("denies import and export for %s callers", async (kind) => {
    if (kind === "unsigned") h.auth = { error: "not_found" };
    else h.allowed = false;
    expect((await importAdventureJson({}, form(JSON.stringify(spec)))).error).toBeTruthy();
    expect((await request()).status).toBe(404);
    expect(h.inserts).toEqual([]);
  });

  it("does not export another teacher’s spec", async () => {
    h.row!.owner_id = "someone-else";
    expect((await request()).status).toBe(404);
  });

  it("exports a JSON attachment without ownership or publication metadata", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ format: "pocket-adventure-v3", version: 1, spec: { title: spec.title }, sources: [] });
    expect(body.owner_id).toBeUndefined();
    expect(body.published_version).toBeUndefined();
  });
});
