import { afterEach, describe, expect, it, vi } from "vitest";

function response() {
  return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
}

describe("service Supabase fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses no-store and distinct abort signals for repeated admin queries", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-test-key");
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    await admin.from("adventure").select("id").limit(1);
    await admin.from("adventure").select("id").limit(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(first.cache).toBe("no-store");
    expect(second.cache).toBe("no-store");
    expect(first.signal).toBeInstanceOf(AbortSignal);
    expect(second.signal).toBeInstanceOf(AbortSignal);
    expect(first.signal).not.toBe(second.signal);
  });

  it("preserves an explicit caller abort signal", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-test-key");
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const controller = new AbortController();
    await admin.from("adventure").select("id").limit(1).abortSignal(controller.signal);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(controller.signal);
  });
});
