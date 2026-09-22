import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  SupabaseRuntimeStore: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/turn-api/supabase-runtime", () => ({
  SupabaseRuntimeStore: mocks.SupabaseRuntimeStore,
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalBackend = process.env.TURN_API_BACKEND;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalBackend === undefined) delete process.env.TURN_API_BACKEND;
  else process.env.TURN_API_BACKEND = originalBackend;
});

describe("createTurnRuntimeBackend", () => {
  it("defaults to memory in test mode without touching Supabase", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.TURN_API_BACKEND;
    const service = await import("@/lib/turn-api/service");

    const backend = await service.createTurnRuntimeBackend();

    expect(backend).not.toBeNull();
    expect(typeof backend?.getState).toBe("function");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.SupabaseRuntimeStore).not.toHaveBeenCalled();
  });

  it("authenticates before constructing the admin client when Supabase is forced", async () => {
    process.env.NODE_ENV = "test";
    process.env.TURN_API_BACKEND = "supabase";
    const userClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    };
    const adminClient = { kind: "admin" };
    const store = { getState: vi.fn(), postMessage: vi.fn(), commitDecision: vi.fn() };
    mocks.createClient.mockResolvedValue(userClient);
    mocks.createAdminClient.mockImplementation(() => {
      expect(userClient.auth.getUser).toHaveBeenCalled();
      return adminClient;
    });
    mocks.SupabaseRuntimeStore.mockImplementation((user, admin) => {
      expect(user).toBe(userClient);
      expect(admin).toBe(adminClient);
      return store;
    });

    const service = await import("@/lib/turn-api/service");
    const backend = await service.createTurnRuntimeBackend();

    expect(backend).toBe(store);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.SupabaseRuntimeStore).toHaveBeenCalledOnce();
  });

  it("returns null for a missing user or auth error without constructing admin", async () => {
    process.env.NODE_ENV = "production";
    const userClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } };
    mocks.createClient.mockResolvedValue(userClient);
    let service = await import("@/lib/turn-api/service");

    await expect(service.createTurnRuntimeBackend()).resolves.toBeNull();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.SupabaseRuntimeStore).not.toHaveBeenCalled();

    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    const authErrorClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "expired" } }) },
    };
    mocks.createClient.mockResolvedValue(authErrorClient);
    service = await import("@/lib/turn-api/service");

    await expect(service.createTurnRuntimeBackend()).resolves.toBeNull();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.SupabaseRuntimeStore).not.toHaveBeenCalled();
  });
});
