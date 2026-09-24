import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { canStep } from "@adventure/game-core";
import { FakeLlmClient } from "@adventure/orchestration";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";
import { PlaySession } from "@/lib/play/session";
import { compileStageMap } from "@/lib/play/layout";

// Uses the real play UI, map movement, and session, with a deliberately held
// movement response. No database, sign-in, or model service is required.
it.runIf(process.env.RUN_READER_BROWSER_TESTS === "1")("opens a parchment immediately on pickup and reopens pending Notes before the server responds", async () => {
  const spec = await loadI1Spec();
  const session = PlaySession.start(spec, "reader-browser", 1);
  const evidence = spec.stages[0]!.evidence[0]!;
  const spatial = session.world.spatial!;
  const to = compileStageMap(spec.stages[0]!, "reader-browser").placements.find((item) => item.id === evidence.id)!.position;
  const from = [{ x: to.x - 1, y: to.y }, { x: to.x + 1, y: to.y }, { x: to.x, y: to.y - 1 }, { x: to.x, y: to.y + 1 }].find((point) => canStep(spatial.map, spatial.state.doors, point, to))!;
  spatial.state.actors.player = from;
  session.world.location.player = evidence.roomId;
  const currentState = () => session.state({ enabled: false, deadlineAt: null });
  const initial = { ...currentState(), revision: 1, mintReady: false };
  const root = resolve("apps/web");
  const stubs: Record<string, string> = {
    "next/navigation": "export const useRouter = () => ({ refresh() {}, push() {} });",
    "next/link": "import React from 'react'; export default function Link(p) { return React.createElement('a', p); }",
    "next/dynamic": "import React from 'react'; export default function dynamic(load) { const C = React.lazy(() => load().then(defaultExport => ({default: defaultExport}))); return p => React.createElement(React.Suspense, {fallback: null}, React.createElement(C, p)); }",
    "@/app/play/[attemptId]/actions": "export const restartAttempt = async () => ({ok:false});",
    "@/components/stage-countdown": "export const StageCountdown = () => null;",
  };
  const vite = await createServer({
    configFile: false, root, publicDir: resolve(root, "public"),
    server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" },
    optimizeDeps: { include: ["react", "react-dom/client", "lucide-react", "phaser", "openai"] },
    css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") } },
    plugins: [{
      name: "reader-test-harness",
      enforce: "pre",
      resolveId(id) {
        if (stubs[id]) return `\0stub:${id}`;
        // Vite's alias runs before plugin resolution.
        if (id.replaceAll("\\", "/").endsWith("/src/app/play/[attemptId]/actions")) return "\0stub:@/app/play/[attemptId]/actions";
        if (id.replaceAll("\\", "/").endsWith("/src/components/stage-countdown")) return "\0stub:@/components/stage-countdown";
        if (id === "virtual:reader-test") return `\0${id}`;
      },
      async load(id) {
        if (id.startsWith("\0stub:")) return stubs[id.slice(6)];
        if (id === "\0virtual:reader-test") return (await transformWithEsbuild(`
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { PlayClient } from '/src/components/play/play-client.tsx';
          import '/src/app/globals.css';
          createRoot(document.getElementById('root')).render(<PlayClient attemptId="reader-browser" initialState={${JSON.stringify(initial)}} retriesAllowed={false} />);
        `, "reader-test.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<html><body><div id="root" style="display:flex;height:100dvh"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/__x00__virtual:reader-test"></script></body></html>');
        });
      },
    }],
  });
  await vite.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  let releaseMove = () => {};
  const moveGate = new Promise<void>((resolve) => { releaseMove = resolve; });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let movementReturned = false;
    let inspectRequests = 0;
    await page.route("**/api/attempt/**", async (route) => {
      if (route.request().url().endsWith("/action")) {
        const action = route.request().postDataJSON();
        if (action.type === "inspect") inspectRequests += 1;
        if (action.type === "move_steps") await moveGate;
        const result = await session.action(new FakeLlmClient({ replies: ['{"say":"unused","actions":[]}'] }), action);
        if (action.type === "move_steps") movementReturned = true;
        await route.fulfill({ json: { accepted: true, refused: result.ok ? result.refused : "failed", state: { ...currentState(), revision: currentState().revision + 1 } } });
      } else await route.fulfill({ json: { ...currentState(), revision: currentState().revision + 1 } });
    });
    await page.goto(vite.resolvedUrls!.local[0]!);
    await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
    await page.getByRole("button", { name: "Notes (0)" }).click();
    expect(await page.getByText("No scrolls collected yet.", { exact: false }).isVisible()).toBe(true);
    await page.locator("canvas").focus();
    await page.keyboard.press(to.x > from.x ? "ArrowRight" : to.x < from.x ? "ArrowLeft" : to.y > from.y ? "ArrowDown" : "ArrowUp");
    const modal = page.getByRole("dialog", { name: evidence.name });
    await modal.waitFor({ timeout: 1_000 });
    expect(movementReturned).toBe(false);
    expect(await modal.getByText("Unfolding the document…").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    // Notes stays useful while the movement/collection request is still held.
    if (await page.getByRole("button", { name: "Notes (1)" }).getAttribute("aria-expanded") !== "true") await page.getByRole("button", { name: "Notes (1)" }).click();
    await page.getByRole("list", { name: "Collected notes" }).getByRole("button").click();
    await modal.waitFor({ timeout: 1_000 });
    expect(movementReturned).toBe(false);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    releaseMove();
    await expect.poll(async () => page.getByRole("list", { name: "Collected notes" }).getByText(evidence.content.text, { exact: false }).count()).toBe(1);
    expect(await modal.count()).toBe(0);
    await page.getByRole("list", { name: "Collected notes" }).getByRole("button").click();
    await modal.getByText("Saved in your notes").waitFor();
    expect(inspectRequests).toBe(0);
    expect(await modal.getByText(evidence.content.text, { exact: true }).isVisible()).toBe(true);
    await mkdir(resolve("output/reader-check"), { recursive: true });
    await page.screenshot({ path: resolve("output/reader-check/scroll-desktop.png") });
    await page.setViewportSize({ width: 390, height: 650 });
    await page.screenshot({ path: resolve("output/reader-check/scroll-mobile.png") });
    const bounds = await modal.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(650);
    const content = modal.getByLabel("Scroll contents");
    expect(await content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await content.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(async () => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await modal.getByRole("button", { name: "Roll up scroll" }).click();
    expect(await modal.count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    releaseMove();
    await browser.close();
    await vite.close();
  }
}, 90_000);
