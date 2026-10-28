import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { DEMO_SAVE_KEY, newDemoV3State } from "../../apps/web/src/lib/demo/v3-session";

// Start Next with NEXT_PUBLIC_APP_ENV=staging, NEXT_PUBLIC_POSTHOG_KEY=phc_local_analytics_test,
// NEXT_PUBLIC_POSTHOG_HOST=http://127.0.0.1:3012/analytics-test. No data leaves the test browser.
it.runIf(process.env.RUN_DEMO_ANALYTICS_BROWSER === "1")("emits labelled events from source readers without duplicate captures or student text", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/analytics-test/**", async route => {
    const request = route.request();
    const body = request.postDataBuffer();
    if (body && /\/e\//.test(request.url())) {
      const raw = body[0] === 0x1f ? gunzipSync(body).toString() : body.toString();
      const data = JSON.parse(raw.startsWith("data=") ? Buffer.from(new URLSearchParams(raw).get("data")!, "base64").toString() : raw);
      events.push(...(Array.isArray(data) ? data : [data]));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ featureFlags: {}, sessionRecording: false, supportedCompression: [] }) });
  });
  try {
    const state = newDemoV3State();
    state.intro = false; state.held = ["life"]; state.open = "life"; state.revision = 1;
    await page.addInitScript(({ key, state }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    }, { key: DEMO_SAVE_KEY, state });
    await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng");
    const question = page.getByRole("region", { name: "Source question" });
    await question.getByRole("radio", { name: "Lim stayed in Singapore throughout the occupation" }).check();
    await question.getByRole("button", { name: "Check answer" }).click();
    await question.getByText(/Not quite/).waitFor();
    await question.getByRole("button", { name: "Check answer" }).click();
    await question.getByRole("radio", { name: "Lim left before the fall, then returned to Malaya in 1943" }).check();
    await question.getByRole("button", { name: "Check answer" }).click();
    await question.getByText("✓ Evidence note saved to your journal.").waitFor();
    await expect.poll(() => events.filter(e => e.event === "demo_quiz_answered").length, { timeout: 15000 }).toBe(2);
    expect(events.filter(e => e.event === "demo_source_inspected")).toHaveLength(1);
    expect(events.filter(e => e.event === "demo_resumed")).toHaveLength(1);
    expect(events.filter(e => e.event === "demo_quiz_answered").map(e => e.properties.correct)).toEqual([false, true]);
    expect(events.filter(e => e.event === "demo_quiz_answered").map(e => e.properties.attempt_in_visit)).toEqual([1, 2]);
    expect(events.every(e => e.properties.environment === "staging")).toBe(true);
    expect(events.some(e => e.event === "$pageview")).toBe(true);
    for (const event of events.filter(e => e.event.startsWith("demo_"))) {
      expect(event.properties.demo_id).toBe("lim-bo-seng");
      expect(event.properties).not.toHaveProperty("text");
    }
    await page.reload();
    await question.getByText("✓ Hint unlocked").waitFor();
    await expect.poll(() => events.filter(e => e.event === "demo_resumed").length, { timeout: 15000 }).toBe(2);
    expect(events.filter(e => e.event === "demo_quiz_answered")).toHaveLength(2);
    expect(events.filter(e => e.event === "demo_chapter_started")).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 90000);
