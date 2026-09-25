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
  const evidence = spec.stages[0]!.evidence[0]!;
  spec.stages[0]!.rooms.find((room) => room.id === evidence.roomId)!.landmark = {
    name: "Ship's notice board",
    description: "A wooden notice board pinned with sailing orders and public memoranda. A faded map curls at the edges, its corners held down with brass pins.",
  };
  const session = PlaySession.start(spec, "reader-browser", 1);
  const spatial = session.world.spatial!;
  const to = compileStageMap(spec.stages[0]!, "reader-browser").placements.find((item) => item.id === evidence.id)!.position;
  const from = [{ x: to.x - 1, y: to.y }, { x: to.x + 1, y: to.y }, { x: to.x, y: to.y - 1 }, { x: to.x, y: to.y + 1 }].find((point) => canStep(spatial.map, spatial.state.doors, point, to))!;
  spatial.state.actors.player = from;
  session.world.location.player = evidence.roomId;
  let includeArchivedScroll = false;
  const currentState = () => {
    const state = session.state({ enabled: false, deadlineAt: null });
    // Omit prepared text so this fixture exercises the network-pending reader.
    return { ...state, evidenceHere: state.evidenceHere.map(({ content, ...item }) => item), journal: [...state.journal, ...(includeArchivedScroll ? [{ id: "earlier-stage-scroll", text: "Earlier discoveries: A record kept from a previous stage.", sourceSpan: "Archive, p. 2", collectedAt: new Date().toISOString() }] : [])] };
  };
  const initial = { ...currentState(), revision: 1, mintReady: false };
  const root = resolve("apps/web");
  const stubs: Record<string, string> = {
    "next/navigation": "export const useRouter = () => ({ refresh() {}, push() {} });",
    "next/link": "import React from 'react'; export default function Link(p) { return React.createElement('a', p); }",
    "next/dynamic": "import React from 'react'; export default function dynamic(load) { const C = React.lazy(() => load().then(defaultExport => ({default: defaultExport}))); return p => React.createElement(React.Suspense, {fallback: null}, React.createElement(C, p)); }",
    "@/app/play/[attemptId]/actions": "export const restartAttempt = async () => ({ok:false}); export const completeWalkthrough = async () => ({ok:true});",
    "@/components/stage-countdown": "export const StageCountdown = () => null;",
  };
  const vite = await createServer({
    configFile: false, root, publicDir: resolve(root, "public"),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
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
          import { AdventureHeader } from '/src/components/play/adventure-header.tsx';
          import { ThemeProvider } from '/src/components/theme-provider.tsx';
          import styles from '/src/components/play/adventure-chrome.module.css';
          import '/src/app/globals.css';
          createRoot(document.getElementById('root')).render(<ThemeProvider><main className={styles.shell} style={{display:'flex', flexDirection:'column', height:'100dvh', width:'100%'}}><AdventureHeader title="A Post at the River Mouth" active={${JSON.stringify(initial)}} recap={[]} /><PlayClient attemptId="reader-browser" initialState={${JSON.stringify(initial)}} retriesAllowed={false} walkthroughSeen={{mobile:true,desktop:true}} /></main></ThemeProvider>);
        `, "reader-test.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<html style="--font-ui:Arial;--font-record:Georgia"><body><div id="root" style="display:flex;height:100dvh"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/__x00__virtual:reader-test"></script></body></html>');
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
    await page.getByRole("button", { name: "Open case board" }).click();
    const board = page.getByRole("dialog", { name: spec.stages[0]!.title });
    expect(await board.getByText(spec.stages[0]!.decision.prompt, { exact: true }).isVisible()).toBe(true);
    expect(await board.getByRole("tab", { name: /Goals/ }).isVisible()).toBe(true);
    expect(await board.getByText(/Finish first: Hear Farquhar's assessment of the island/).isVisible()).toBe(true);
    await mkdir(resolve("output/reader-check"), { recursive: true });
    await page.screenshot({ path: resolve("output/reader-check/case-board-desktop.png") });
    await page.setViewportSize({ width: 390, height: 650 });
    await page.screenshot({ path: resolve("output/reader-check/case-board-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await board.getByRole("tab", { name: /Goals/ }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await board.getByRole("tab", { name: /Evidence/ }).getAttribute("aria-selected")).toBe("true");
    await board.getByRole("tab", { name: "Decision locked" }).click();
    expect(await board.getByText("Finish the available goals and their prerequisites first.").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.getByRole("button", { name: "Open case board" }).evaluate((element) => element === document.activeElement)).toBe(true);
    await page.getByRole("button", { name: "Open case board" }).click();
    await board.getByRole("tab", { name: /Evidence/ }).click();
    await board.getByRole("button", { name: /Compare witness accounts/ }).click();
    const accounts = page.getByRole("dialog", { name: "What do the witnesses disagree about?" });
    expect(await accounts.getByText(spec.stages[0]!.accountClues[0]!.question).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await mkdir(resolve("output/reader-check"), { recursive: true });
    const roleButton = page.getByRole("button", { name: `Open your role brief: ${spec.player.role}` });
    await roleButton.click();
    const roleCard = page.getByRole("dialog", { name: spec.player.role });
    await roleCard.waitFor();
    await page.screenshot({ path: resolve("output/reader-check/character-card-desktop.png") });
    for (let tab = 0; tab < 5; tab += 1) {
      await page.keyboard.press("Tab");
      expect(await roleCard.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 650 });
    await page.screenshot({ path: resolve("output/reader-check/character-card-mobile.png") });
    const roleBounds = await roleCard.boundingBox();
    expect(roleBounds!.y).toBeGreaterThanOrEqual(0);
    expect(roleBounds!.y + roleBounds!.height).toBeLessThanOrEqual(650);
    await page.keyboard.press("Escape");
    expect(await roleButton.evaluate((element) => element === document.activeElement)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: resolve("output/reader-check/notes-toolbar-desktop.png") });
    await page.getByRole("group", { name: "Adventure tools" }).getByRole("button", { name: "Notes (0)" }).click();
    expect(await page.getByText("No scrolls collected yet.", { exact: false }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.getByRole("button", { name: "Notes (0)" }).evaluate((element) => element === document.activeElement)).toBe(true);
    await page.locator("canvas").focus();
    await page.keyboard.press(to.x > from.x ? "ArrowRight" : to.x < from.x ? "ArrowLeft" : to.y > from.y ? "ArrowDown" : "ArrowUp");
    const modal = page.getByRole("dialog", { name: evidence.name });
    await modal.waitFor({ timeout: 1_000 });
    expect(movementReturned).toBe(false);
    expect(await modal.getByText("Unfolding the document…").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    // Notes stays useful while the movement/collection request is still held.
    await page.getByRole("button", { name: "Notes (1)" }).click();
    await modal.waitFor({ timeout: 1_000 });
    expect(movementReturned).toBe(false);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    releaseMove();
    await expect.poll(() => movementReturned).toBe(true);
    expect(await modal.count()).toBe(0);
    await page.getByRole("button", { name: "Notes (1)" }).click();
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
    expect(await page.getByRole("button", { name: "Notes (1)" }).evaluate((element) => element === document.activeElement)).toBe(true);
    await page.screenshot({ path: resolve("output/reader-check/notes-toolbar-mobile.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    includeArchivedScroll = true;
    await page.getByRole("button", { name: "Notes (2)" }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Notes (2)" }).click();
    const notes = page.getByRole("dialog");
    expect(await notes.getByRole("heading", { name: "Earlier discoveries" }).isVisible()).toBe(true);
    expect(await notes.getByRole("button", { name: "Next scroll" }).isDisabled()).toBe(true);
    await notes.getByRole("button", { name: "Previous scroll" }).click();
    expect(await notes.getByText(evidence.content.text, { exact: true }).isVisible()).toBe(true);
    expect(await notes.getByRole("button", { name: "Previous scroll" }).isDisabled()).toBe(true);
    await notes.getByLabel("Choose a collected scroll").selectOption("earlier-stage-scroll");
    expect(await notes.getByText("A record kept from a previous stage.", { exact: true }).isVisible()).toBe(true);
    await notes.getByRole("button", { name: "Previous scroll" }).click();
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    await page.screenshot({ path: resolve("output/reader-check/notes-dark-mobile.png") });
    const mobileBounds = await notes.boundingBox();
    expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(650);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: resolve("output/reader-check/notes-dark-desktop.png") });
    await page.keyboard.press("Escape");
    expect(await page.getByRole("button", { name: "Notes (2)" }).evaluate((element) => element === document.activeElement)).toBe(true);
    await page.screenshot({ path: resolve("output/reader-check/game-dark-desktop.png") });

    // The secondary room controls use the same inspection and walking path as the map.
    const landmark = currentState().landmarks.find((item) => item.roomId === evidence.roomId)!;
    await page.getByText("Look around", { exact: true }).click();
    await page.getByRole("button", { name: `Inspect ${landmark.name}` }).click();
    const landmarkCard = page.getByRole("dialog", { name: landmark.name });
    await landmarkCard.waitFor({ timeout: 20_000 });
    await page.screenshot({ path: resolve("output/reader-check/landmark-dark-desktop.png") });
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    await page.screenshot({ path: resolve("output/reader-check/landmark-desktop.png") });
    await page.setViewportSize({ width: 390, height: 650 });
    await page.screenshot({ path: resolve("output/reader-check/landmark-mobile.png") });
    const landmarkBounds = await landmarkCard.boundingBox();
    expect(landmarkBounds!.y + landmarkBounds!.height).toBeLessThanOrEqual(650);
    await landmarkCard.getByRole("button", { name: "Continue exploring" }).click();
    await page.setViewportSize({ width: 1280, height: 900 });

    // A timer transition must dismiss an old open scroll and explain the new dilemma.
    await page.getByRole("button", { name: "Notes (2)" }).click();
    await session.expire();
    const nextStage = session.state({ enabled: false, deadlineAt: null }).stage;
    expect(nextStage.index).toBe(1);
    const briefing = page.getByRole("dialog", { name: spec.player.role });
    try {
      await briefing.waitFor({ timeout: 35_000 });
    } catch (error) {
      await page.screenshot({ path: resolve("output/reader-check/transition-failure.png") });
      throw error;
    }
    expect(await page.getByLabel("Scroll contents").count()).toBe(0);
    expect(await briefing.getByText(spec.stages[1]!.decision.prompt, { exact: true }).isVisible()).toBe(true);
    const begin = briefing.getByRole("button", { name: `Begin as ${spec.player.name}` });
    if (!await begin.isVisible()) await briefing.getByRole("button", { name: "Skip", exact: true }).click();
    await begin.click();
    await page.getByRole("button", { name: "Notes (2)" }).click();
    await page.getByLabel("Choose a collected scroll").selectOption(evidence.id);
    expect(await page.getByText(evidence.content.text, { exact: true }).isVisible()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    releaseMove();
    await browser.close();
    await vite.close();
  }
}, 90_000);
