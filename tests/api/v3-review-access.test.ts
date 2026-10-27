import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  allowed: true,
  staff: true,
  sysadmin: false,
  membership: null as { role: string; organizationId: string } | null,
  user: { id: "owner" } as { id: string } | null,
  row: { ownerId: "owner", schoolId: "school", status: "draft" } as {
    ownerId: string;
    schoolId: string;
    status: string;
  } | null,
  loadSpec: vi.fn(),
  progress: vi.fn(),
  sources: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/v3/flag", () => ({
  v3Enabled: () => mocks.enabled,
  v3SchoolAllowed: () => mocks.allowed,
}));
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => ({ user: mocks.user, membership: mocks.membership, isSysadmin: mocks.sysadmin }),
  isStaff: () => mocks.staff,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/v3/brief/store", () => ({
  supabaseV3BriefStore: () => ({ load: async () => mocks.row }),
}));
vi.mock("@/lib/v3/generation/deps", () => ({
  supabaseV3SourceStore: () => ({ load: mocks.sources }),
}));
vi.mock("@/lib/play/v3/store", () => ({
  SupabaseV3PlayStore: class {
    loadAdventure = mocks.loadSpec;
    async loadCheckErrors() { return []; }
  },
}));
vi.mock("@/app/v3/teacher/actions", () => ({
  getV3GenerationProgress: mocks.progress,
}));
vi.mock("@/components/play/v3/publish-panel", () => ({
  V3PublishPanel: () => null,
}));
vi.mock("@/components/ui", () => ({
  Page: () => null,
  button: { subtle: "", primary: "" },
  compactButton: { subtle: "", primary: "" },
}));

import ReviewPage from "@/app/v3/teacher/[id]/review/adventure-workspace";
const visit = () =>
  ReviewPage({ params: Promise.resolve({ id: "adventure" }) });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    enabled: true,
    allowed: true,
    staff: true,
    sysadmin: false,
    membership: null,
    user: { id: "owner" },
    row: { ownerId: "owner", schoolId: "school", status: "draft" },
  });
  mocks.loadSpec.mockResolvedValue({
    spec: JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  });
  mocks.progress.mockResolvedValue({ warnings: [], checkErrors: [] });
  mocks.sources.mockResolvedValue([]);
});

describe("review page access", () => {
  it("allows a system admin without a school membership to open any school's editor", async () => {
    mocks.row!.ownerId = "other-teacher";
    mocks.sysadmin = true; mocks.staff = false; mocks.allowed = false;
    expect(await visit()).toBeTruthy();
  });
  it("allows an admin to edit another teacher's adventure in the same school", async () => {
    mocks.row!.ownerId = "other-teacher";
    mocks.membership = { role: "admin", organizationId: "school" };
    expect(await visit()).toBeTruthy();
    expect(mocks.loadSpec).toHaveBeenCalledWith("adventure");
  });
  it("rejects an admin from a different school", async () => {
    mocks.row!.ownerId = "other-teacher";
    mocks.membership = { role: "admin", organizationId: "different-school" };
    await expect(visit()).rejects.toThrow("NOT_FOUND");
    expect(mocks.loadSpec).not.toHaveBeenCalled();
  });
  it.each([
    "feature",
    "school",
    "signed-out",
    "student",
    "other-owner",
    "missing",
    "generating",
  ])("rejects %s before loading private content", async (guard) => {
    if (guard === "feature") mocks.enabled = false;
    if (guard === "school") mocks.allowed = false;
    if (guard === "signed-out") mocks.user = null;
    if (guard === "student") mocks.staff = false;
    if (guard === "other-owner") mocks.row!.ownerId = "other";
    if (guard === "missing") mocks.row = null;
    if (guard === "generating") mocks.row!.status = "generating";
    await expect(visit()).rejects.toThrow("NOT_FOUND");
    expect(mocks.loadSpec).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
  });
  it.each(["draft", "published", "archived"])(
    "loads a %s owned by the signed-in staff member",
    async (status) => {
      mocks.row!.status = status;
      expect(await visit()).toBeTruthy();
      expect(mocks.loadSpec).toHaveBeenCalledWith("adventure");
    },
  );
  it("does not hide a failed check read", async () => {
    mocks.progress.mockResolvedValue({ error: "not_found" });
    await expect(visit()).rejects.toThrow("Could not load generation checks");
  });
});
