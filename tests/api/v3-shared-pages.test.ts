import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), viewer: vi.fn(), artwork: vi.fn(), adminFrom: vi.fn(),
  library: [] as Record<string, unknown>[], usage: [] as Record<string, unknown>[],
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (url: string) => { throw Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.adminFrom }) }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: mocks.viewer, isStaff: (viewer: { membership?: { role: string } }) => ["teacher", "admin"].includes(viewer.membership?.role ?? "") }));
vi.mock("@/lib/teacher/library", () => ({ loadLibraryArtwork: mocks.artwork }));
vi.mock("@/components/site-navigation", () => ({ SiteNavigation: () => null }));
vi.mock("@/components/theme-provider", () => ({ ThemeSelect: () => null }));
vi.mock("@/components/sign-in-button", () => ({ SignInButton: () => null }));
vi.mock("@/components/action-form", () => ({
  ActionButton: ({ label }: { label: string }) => React.createElement("button", null, label),
  ActionForm: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));
vi.mock("@/app/school/[slug]/school-link-copy", () => ({ SchoolLinkCopy: ({ path }: { path: string }) => React.createElement("a", { href: path }, "Copy link") }));

import LibraryPage from "@/app/library/page";
import SchoolPage from "@/app/school/[slug]/page";
import AdminPage from "@/app/admin/page";
import { setAdventureArchived } from "@/app/school/[slug]/actions";

vi.stubGlobal("React", React);
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("V3_ENABLED", "1"); vi.stubEnv("V3_SCHOOL_IDS", "school");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://assets.example.test");
  mocks.library = []; mocks.usage = [];
  mocks.viewer.mockResolvedValue({ user: { id: "staff" }, isSysadmin: true,
    membership: { organizationId: "school", slug: "school", organizationName: "School", role: "admin" } });
  mocks.artwork.mockResolvedValue(new Map());
  mocks.adminFrom.mockImplementation(() => ({ select: () => ({ in: () => ({ returns: async () => ({ data: [{ id: "old", published_version: 1 }] }) }) }) }));
  mocks.rpc.mockImplementation((name: string) => {
    const data = name === "list_library_all_versions" ? mocks.library
      : name === "school_usage_all_versions" ? mocks.usage
      : name === "platform_overview_all_versions" ? [{ adventures: 2, published_adventures: 2, unmeasured_v3_attempts: 1, unmeasured_v3_adventures: 1 }]
      : name === "platform_school_stats_all_versions" ? [{ organization_id: "school", name: "School", slug: "school", unmeasured_v3_adventures: 1 }]
      : [];
    return { data, error: null, returns: async () => ({ data, error: null }) };
  });
});
function libraryRow(id: string, kind: "v2" | "v3", status: string | null = null) {
  return { adventure_id: id, kind, title: `Story ${id}`, published_version: 3, organization_id: "school", teacher_name: "Teacher",
    setting: "Singapore", allow_retries: kind === "v2", latest_attempt_id: status ? `attempt-${id}` : null, latest_attempt_status: status };
}
function usageRow(id: string, kind: "v2" | "v3", status = "published") {
  return { adventure_id: id, kind, title: `Story ${id}`, status, share_token: "old-token", shareable: true,
    attempts: 1, students: 1, completed: 1, play_seconds: kind === "v3" ? null : 30, play_tokens: 10,
    image_cost_usd: kind === "v3" ? null : 0.01, school_students: 1, version_students: 1 };
}
describe("version-aware shared pages", () => {
  it("routes starts, resumes and completed results by version and uses published-version artwork", async () => {
    mocks.library = [libraryRow("old", "v2"), libraryRow("start", "v3"), libraryRow("resume", "v3", "active"),
      libraryRow("finished", "v3", "completed"), libraryRow("legacy-results", "v2", "completed")];
    const html = renderToStaticMarkup(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.rpc).toHaveBeenCalledWith("list_library_all_versions", { p_include_v3: true });
    expect(html).toContain('href="/v3/play/start/start"');
    expect(html).toContain('href="/v3/play/attempt-resume"');
    expect(html).toContain('href="/v3/play/attempt-finished"');
    expect(html).toContain('href="/play/attempt-legacy-results/debrief"');
    expect(html).toContain("View results");
    expect(html).toContain('id="library-v3"');
    expect(html).toContain('id="library-v2"');
    expect(html.indexOf("Story start")).toBeLessThan(html.indexOf('id="library-v2"'));
    expect(html.indexOf("Story old")).toBeGreaterThan(html.indexOf('id="library-v2"'));
    expect(html).toContain("/v3/stage-art/start/v3/stage-0.webp");
    expect(mocks.artwork).toHaveBeenCalledWith(expect.anything(), [{ id: "old", published_version: 1 }], { publishedOnly: true });
  });

  it.each(["disabled", "other-school"])("does not request v3 library rows when %s", async (reason) => {
    if (reason === "disabled") vi.stubEnv("V3_ENABLED", "0");
    else vi.stubEnv("V3_SCHOOL_IDS", "different-school");
    await LibraryPage({ searchParams: Promise.resolve({}) });
    expect(mocks.rpc).toHaveBeenCalledWith("list_library_all_versions", { p_include_v3: false });
  });

  it("shows both school listings with correct detail/share/results links and missing measurements", async () => {
    mocks.usage = [usageRow("old", "v2"), usageRow("new", "v3"), usageRow("busy", "v3", "generating")];
    const html = renderToStaticMarkup(await SchoolPage({ params: Promise.resolve({ slug: "school" }), searchParams: Promise.resolve({ tab: "adventures" }) }));
    expect(html).toContain('href="/teacher/old?tab=attempts"');
    expect(html).toContain('href="/v3/teacher/new"');
    expect(html).toContain('href="/join/old-token"');
    expect(html).toContain('href="/v3/join/new"');
    expect(html).toContain('href="/v3/teacher/new/summary"');
    expect(html).toContain("Play time and image costs are not recorded for V3 adventures.");
    expect(html).toContain("V3 adventures");
    expect(html).toContain("V2 adventures");
    expect(html.match(/>Archive</g)).toHaveLength(4);
  });

  it("rejects disabled-school mutations and passes school and version to archive RPCs", async () => {
    expect(await setAdventureArchived("school", "new", true, "v3")).toMatchObject({ notice: "Adventure archived." });
    expect(mocks.rpc).toHaveBeenCalledWith("set_adventure_archived_v3", { p_org: "school", p_adventure_id: "new", p_archived: true });
    await setAdventureArchived("school", "old", false);
    expect(mocks.rpc).toHaveBeenCalledWith("set_adventure_archived", { p_adventure_id: "old", p_archived: false });
    mocks.rpc.mockClear(); vi.stubEnv("V3_ENABLED", "0");
    expect(await setAdventureArchived("school", "new", true, "v3")).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("loads combined admin metrics and labels partial measurement coverage", async () => {
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }));
    for (const name of ["platform_overview_all_versions", "platform_school_stats_all_versions", "platform_activity_daily_all_versions"])
      expect(mocks.rpc).toHaveBeenCalledWith(name, { p_since: expect.any(String) });
    expect(html).toContain("LLM spend includes both versions");
    expect(html).toContain("measured values only");
  });
});
