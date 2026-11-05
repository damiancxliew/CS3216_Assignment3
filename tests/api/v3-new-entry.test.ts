import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "teacher" } as { id: string } | null,
  membership: { role: "teacher" } as { role: string } | null,
  start: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, useRouter: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => ({ user: h.user, membership: h.membership }),
  isStaff: (viewer: { membership: { role: string } | null }) => ["teacher", "admin"].includes(viewer.membership?.role ?? ""),
}));
vi.mock("@/app/v3/teacher/actions", () => ({ startV3Brief: h.start }));
vi.mock("@/components/ui", () => ({ button: { primary: "" }, Pending: () => null, ErrorText: () => null }));

import NewAdventure from "@/app/v3/teacher/new/page";
import { StartBriefRedirect } from "@/app/v3/teacher/new/start-button";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  h.user = { id: "teacher" };
  h.membership = { role: "teacher" };
});

afterEach(() => vi.unstubAllGlobals());

describe("new adventure entry", () => {
  it("hands off directly to automatic workspace navigation without creating during server rendering or prefetch", async () => {
    const element = await NewAdventure();
    expect(element.type).toBe(StartBriefRedirect);
    expect(h.start).not.toHaveBeenCalled();
  });
  it.each(["signed-out", "no-school", "student"])("preserves the %s access restriction", async (mode) => {
    if (mode === "signed-out") h.user = null;
    if (mode === "no-school") h.membership = null;
    if (mode === "student") h.membership = { role: "student" };
    await expect(NewAdventure()).rejects.toThrow("NOT_FOUND");
    expect(h.start).not.toHaveBeenCalled();
  });
});
