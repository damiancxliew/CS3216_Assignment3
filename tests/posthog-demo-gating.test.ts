import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PostHogConfig } from "posthog-js";

const sdk = vi.hoisted(() => ({ init: vi.fn(), register: vi.fn(), capture: vi.fn(), set_config: vi.fn() }));
vi.mock("posthog-js", () => ({ default: sdk }));
vi.mock("posthog-js/react", () => ({ PostHogProvider: () => null }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("window", { location: new URL("https://staging.pocketadventures.world/demo/lim-bo-seng") });
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_only");
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("isolates staging persistence and adds environment to every event before sending", async () => {
  const { trackDemo } = await import("../apps/web/src/lib/analytics/posthog");
  trackDemo({ event: "demo_started", properties: { demo_id: "lim-bo-seng" } });
  expect(sdk.init).toHaveBeenCalledTimes(1);
  const config = sdk.init.mock.calls[0][1] as PostHogConfig;
  expect(config).toMatchObject({ persistence_name: "pocket-adventures-staging", cross_subdomain_cookie: false });
  const beforeSend = config.before_send as (event: { properties: Record<string, unknown> }) => { properties: Record<string, unknown> };
  expect(beforeSend({ properties: { environment: "production" } }).properties.environment).toBe("staging");
  expect(sdk.capture).toHaveBeenCalledWith("demo_started", { demo_id: "lim-bo-seng" });
});
it.each(["production", "development", "preview"])("does not send demo events in %s", async environment => {
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", environment);
  const { trackDemo } = await import("../apps/web/src/lib/analytics/posthog");
  trackDemo({ event: "demo_started", properties: {} });
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled();
});
it("does nothing without a key and contains capture failures", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  const disabled = await import("../apps/web/src/lib/analytics/posthog");
  disabled.trackDemo({ event: "demo_started", properties: {} });
  expect(sdk.capture).not.toHaveBeenCalled();
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_only");
  sdk.capture.mockImplementationOnce(() => { throw new Error("blocked"); });
  const enabled = await import("../apps/web/src/lib/analytics/posthog");
  expect(() => enabled.trackDemo({ event: "demo_started", properties: {} })).not.toThrow();
});
