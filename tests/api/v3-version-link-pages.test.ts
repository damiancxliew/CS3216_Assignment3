import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { V3PlayStore } from "@/lib/play/v3/store";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { readFileSync } from "node:fs";

const context = vi.hoisted(() => ({ store: null as unknown as V3PlayStore, user: "teacher" as string | null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (path: string) => { throw Error(`REDIRECT:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "school.example", "x-forwarded-proto": "https" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: context.user ? { id: context.user } : null } }) } }) }));
vi.mock("@/lib/play/http", () => ({ requireUserId: async () => context.user, readJson: async (request: Request) => request.json() }));
vi.mock("@/lib/play/v3/http", () => ({ v3PublishDeps: () => ({ store: context.store }), v3PlayDeps: () => ({ store: context.store }) }));
vi.mock("@/components/ui", () => ({ Page: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children), SiteHeader: () => null, ErrorText: () => null, button: {} }));
vi.mock("@/components/teacher/v3-adventure-nav", () => ({ V3AdventureNav: () => null }));
vi.mock("@/components/sign-in-button", () => ({ SignInButton: ({ next }: { next: string }) => React.createElement("a", { "data-sign-in-next": next }, "Sign in") }));
vi.mock("@/app/v3/teacher/[id]/links/student-link", () => ({
  CopyStudentLink: ({ path }: { path: string }) => React.createElement("button", { "data-copy-path": path }),
  ReleaseLink: ({ path }: { path: string }) => React.createElement("a", { href: path }, "Open"),
}));
import HistoryPage from "@/app/v3/teacher/[id]/links/page";
import JoinPage from "@/app/v3/join/[versionId]/page";
import { GET as start } from "@/app/v3/play/start/[versionId]/route";
import { POST as createAttemptRequest } from "@/app/api/v3/attempts/route";
import { currentV3StudentLink } from "@/app/v3/teacher/[id]/publish-actions";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubEnv("V3_ENABLED", "true"); vi.stubEnv("V3_SCHOOL_IDS", "school");
  context.user = "teacher";
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function fixture() {
  const store = new MemoryV3PlayStore();
  const id = "00000000-0000-4000-8000-000000000001";
  const spec = JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8"));
  store.addAdventure({ id, ownerId: "teacher", schoolId: "school", status: "published", specVersion: 1, spec });
  store.addMember("school", "teacher");
  const first = (await store.listPublications(id))[0];
  await store.saveDraft(id, 1, { ...spec, title: "Second version" });
  await store.publishVersion(id, 2, 1, true);
  const second = (await store.listPublications(id)).find(row => row.version === 2)!;
  context.store = store;
  return { store, id, first, second };
}
it("copies the current version from publish controls and each own version on both history layouts", async () => {
  const { id, first, second } = await fixture();
  expect(await currentV3StudentLink(id)).toEqual({ ok: true, path: `/v3/join/${second.id}` });
  const html = renderToStaticMarkup(await HistoryPage({ params: Promise.resolve({ id }) }));
  for (const version of [first, second]) {
    expect(html.match(new RegExp(`data-copy-path="/v3/join/${version.id}"`, "g"))).toHaveLength(2);
    expect(html).toContain(`href="/v3/join/${version.id}"`);
  }
  expect(html).not.toContain("?release=");
  expect(html).not.toContain(`/v3/join/${id}`);
});
it("preserves the version ID through sign-in and entry, and closes generic adventure links", async () => {
  const { id, first, second } = await fixture();
  context.user = null;
  const html = renderToStaticMarkup(await JoinPage({ params: Promise.resolve({ versionId: second.id }) }));
  expect(html).toContain(`data-sign-in-next="/v3/join/${second.id}"`);
  expect(html).toContain("Second version");
  const redirect = await start(new Request(`https://school.example/v3/play/start/${first.id}`), { params: Promise.resolve({ versionId: first.id }) });
  expect(redirect.headers.get("location")).toBe(`https://school.example/v3/join/${first.id}`);
  context.user = "teacher";
  const ready = renderToStaticMarkup(await JoinPage({ params: Promise.resolve({ versionId: second.id }) }));
  expect(ready).toContain(`href="/v3/play/start/${second.id}"`);
  const closed = renderToStaticMarkup(await JoinPage({ params: Promise.resolve({ versionId: id }) }));
  expect(closed).toContain("This link isn’t open");
  expect(closed).not.toContain("Enter the adventure");
});

it("redirects old version-specific links without reviving generic adventure entry", async () => {
  const { id, second } = await fixture();
  await expect(JoinPage({ params: Promise.resolve({ versionId: id }), searchParams: Promise.resolve({ release: second.id }) }))
    .rejects.toThrow(`REDIRECT:/v3/join/${second.id}`);
  const closed = renderToStaticMarkup(await JoinPage({ params: Promise.resolve({ versionId: id }), searchParams: Promise.resolve({ release: "not-a-version" }) }));
  expect(closed).toContain("This link isn’t open");
});

it("requires a version ID at the HTTP boundary and enforces membership for that version", async () => {
  const { id, second, store } = await fixture();
  const request = (body: unknown) => createAttemptRequest(new Request("https://school.example/api/v3/attempts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  expect((await request({ adventureId: id })).status).toBe(400);
  expect((await request({ versionId: id })).status).toBe(404);
  const created = await request({ versionId: second.id });
  expect(created.status).toBe(201);
  expect((await store.loadAttempt((await created.json()).attemptId))?.specVersion).toBe(2);
  context.user = "outsider";
  expect((await request({ versionId: second.id })).status).toBe(404);
});
