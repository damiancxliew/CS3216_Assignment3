import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { getUser: vi.fn(), signInAnonymously: vi.fn(), signOut: vi.fn() },
  rpc: vi.fn(),
  loadJoinView: vi.fn(),
  createAttempt: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks.auth, rpc: mocks.rpc }) }));
vi.mock("@/lib/play/v3/http", () => ({ v3PlayDeps: () => ({}), v3PublishDeps: () => ({}) }));
vi.mock("@/lib/play/v3/publish", () => ({ loadJoinView: mocks.loadJoinView }));
vi.mock("@/lib/play/v3/service", () => ({ createAttempt: mocks.createAttempt }));
vi.mock("@/lib/v3/flag", () => ({ v3Enabled: () => true }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { GET } from "@/app/v3/play/start/[adventureId]/route";
import { joinAdventure } from "@/app/join/[token]/actions";

const adventureId = "00000000-0000-4000-8000-000000000001";
const user = { id: "guest-1", is_anonymous: true };
const start = () => GET(new Request(`http://localhost/v3/play/start/${adventureId}?release=release-1`), {
  params: Promise.resolve({ adventureId }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  vi.stubEnv("NEXT_PUBLIC_DATA_URL", "");
  mocks.auth.getUser.mockResolvedValue({ data: { user: null } });
  mocks.auth.signInAnonymously.mockResolvedValue({ data: { user }, error: null });
  mocks.loadJoinView.mockResolvedValue({ kind: "ready" });
  mocks.createAttempt.mockResolvedValue({ status: 201, body: { attemptId: "attempt-1" } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "public_share_link" ? true : "attempt-1", error: null }));
});

afterEach(() => vi.unstubAllEnvs());

describe("public entry", () => {
  it("creates a guest session only for an open v3 link and preserves its release", async () => {
    const response = await start();
    expect(response.headers.get("location")).toBe("http://localhost/v3/play/attempt-1");
    expect(mocks.auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(mocks.createAttempt).toHaveBeenCalledWith({}, user.id, adventureId, "release-1");
  });

  it("does not create guest identities for school-only or invalid links", async () => {
    for (const kind of ["closed", "sign_in"]) {
      mocks.loadJoinView.mockResolvedValue({ kind });
      const response = await start();
      expect(response.headers.get("location")).toContain(`/v3/join/${adventureId}`);
    }
    expect(mocks.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(mocks.createAttempt).not.toHaveBeenCalled();
  });

  it("keeps a signed-in outsider's identity", async () => {
    mocks.auth.getUser.mockResolvedValue({ data: { user: { id: "outsider" } } });
    await start();
    expect(mocks.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(mocks.createAttempt).toHaveBeenCalledWith({}, "outsider", adventureId, "release-1");
  });

  it("does not start an attempt after guest authentication fails", async () => {
    mocks.auth.signInAnonymously.mockResolvedValue({ data: { user: null }, error: { message: "disabled" } });
    expect((await start()).status).toBe(503);
    expect(mocks.createAttempt).not.toHaveBeenCalled();
  });

  it("syncs guests to the split data deployment before starting", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_URL", "http://localhost:3001");
    await start();
    expect(mocks.rpc).toHaveBeenCalledWith("sync_auth_user");
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.createAttempt.mock.invocationCallOrder[0]);
  });

  it("clears an unusable guest session when split-data identity sync fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_URL", "http://localhost:3001");
    mocks.rpc.mockResolvedValue({ error: { message: "sync failed" } });
    expect((await start()).status).toBe(503);
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
    expect(mocks.createAttempt).not.toHaveBeenCalled();
  });

  it("starts and resumes legacy public play through the existing admission RPC", async () => {
    await expect(joinAdventure(adventureId)).rejects.toThrow("redirect:/play/attempt-1");
    expect(mocks.auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("join_adventure", { p_token: adventureId });
  });

  it("does not create a legacy guest for a closed or school-only link", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(joinAdventure(adventureId)).rejects.toThrow(`redirect:/join/${adventureId}`);
    expect(mocks.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("join_adventure", expect.anything());
  });
});
