import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";
import { createState, EngineSpec, project, step } from "@adventure/engine";
import { findPath, type Point } from "@adventure/game-core";
import { createRng, FakeLlmClient } from "@adventure/orchestration";
import { v3AdventureScenery } from "@/lib/play/v3/scenery";

// Actual v3 UI, CSS, renderer and engine. Only HTTP transport and Next's font/link
// adapters are replaced. No authentication, database or model service is exercised.
it.runIf(process.env.RUN_V3_MAP_BROWSER_TESTS === "1")("renders public scenery and lets the player walk, greet and resize", async () => {
  const output = resolve(process.env.V3_MAP_OUTPUT ?? "output/v3-map-check");
  await mkdir(output, { recursive: true });
  const golden = EngineSpec.parse(JSON.parse(await readFile("fixtures/golden-1819.json", "utf8")));
  const rainy = structuredClone(golden);
  rainy.stages[0]!.title = "Rain at the harbour records office";
  rainy.stages[0]!.timePlace = "Singapore harbour, a rainy afternoon in 1930 — visual test fixture";
  rainy.stages[0]!.rooms[0]!.name = "Harbour records office";
  rainy.stages[0]!.rooms[0]!.description = "A shortwave radio and telegraph on a desk beside the filing cabinet.";
  rainy.stages[0]!.rooms[1]!.name = "Records archive";
  rainy.stages[0]!.rooms[1]!.description = "Shelves of records and a filing cabinet.";
  rainy.stages[0]!.rooms[2]!.name = "Cargo warehouse";
  rainy.stages[0]!.rooms[2]!.description = "A warehouse beside the harbour quay and docks.";
  const specs = { golden, rainy };
  const deps = { now: Date.now(), rng: createRng("map-browser"), llm: new FakeLlmClient({ replies: [() => { throw new Error("Map checks must not call an LLM"); }] }) };
  const sessions = await Promise.all(Object.entries(specs).map(async ([id, spec]) => {
    let state = createState(spec, id);
    for (let i = 0; i < 2; i++) state = (await step({ spec, state, action: { type: "continue" } }, deps)).state;
    return [id, { spec, state, revision: 0 }] as const;
  }));
  const data = Object.fromEntries(sessions);
  const root = resolve("apps/web");
  const stubs: Record<string, string> = {
    "next/font/google": "export const Pixelify_Sans = () => ({className: ''});",
    "next/link": "import React from 'react'; export default function Link(p) { return React.createElement('a', p); }",
  };
  const vite = await createServer({
    configFile: false, root, publicDir: resolve(root, "public"),
    cacheDir: resolve("node_modules/.vite/v3-map"),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" },
    optimizeDeps: { include: ["react", "react-dom/client", "phaser", "lucide-react"] },
    css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") } },
    plugins: [{
      name: "v3-map-browser-fixture", enforce: "pre",
      resolveId(id) {
        if (stubs[id]) return `\0stub:${id}`;
        if (id.startsWith("virtual:v3-map-")) return `\0${id}`;
      },
      async load(id) {
        if (id.startsWith("\0stub:")) return stubs[id.slice(6)];
        if (!id.startsWith("\0virtual:v3-map-")) return;
        const name = id.slice("\0virtual:v3-map-".length);
        const session = data[name]!;
        return (await transformWithEsbuild(`
          import React from 'react';
          import Phaser from 'phaser';
          import {createRoot} from 'react-dom/client';
          import {V3PlayClient} from '/src/components/play/v3/v3-play-client.tsx';
          import {V3PreviewHeaderActions} from '/src/components/play/v3/v3-preview-client.tsx';
          import '/src/app/globals.css';
          const boot = Phaser.Game.prototype.boot;
          Phaser.Game.prototype.boot = function() { window.mapReviewGame = this; boot.call(this); };
          createRoot(document.getElementById('root')).render(<V3PlayClient
            attemptId=${JSON.stringify(name)}
            initialView={${JSON.stringify(project(session.spec, session.state))}}
            initialRevision={0}
            scenery={${JSON.stringify(v3AdventureScenery(session.spec))}}
            headerActions={<V3PreviewHeaderActions adventureId="local-visual-fixture" />}
          />);
        `, "map-fixture.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const name = req.url?.slice(1);
          if (!name || !data[name]) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(`<html style="--font-ui:Arial;--font-record:Georgia"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:v3-map-${name}"></script></body></html>`);
        });
      },
    }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const errors: string[] = [];
  const actions: string[] = [];
  const metrics: unknown[] = [];
  try {
    await vite.listen();
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("play.muted", "1"));
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/v3/attempts/**", async route => {
      const name = new URL(route.request().url()).pathname.split("/")[4]!;
      const session = data[name]!;
      if (route.request().method() === "POST") {
        const { action } = route.request().postDataJSON();
        actions.push(action.type);
        session.state = (await step({ spec: session.spec, state: session.state, action }, deps)).state;
        session.revision++;
      }
      await route.fulfill({ json: { revision: session.revision, view: project(session.spec, session.state) } });
    });
    const open = async (name: string) => {
      await page.goto(`${vite.resolvedUrls!.local[0]}${name}`);
      await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
      await page.getByRole("button", { name: "Hide mission" }).click();
      await expect.poll(() => inspect(page)).toMatchObject({ ready: true });
    };
    await open("golden");
    const first = await inspect(page);
    expect(first.descriptions).toEqual(v3AdventureScenery(golden)[0]!.roomDescriptions);
    expect(first.fixtures).toBe(3);
    expect(first.streetStops).toBeGreaterThan(12);
    expect(first.outdoorProps).toBeGreaterThan(0);
    expect(first.people).toBe(4);
    expect(first.uniqueStarts).toBe(first.people + first.animals);
    expect(first.animals).toBeGreaterThan(0);
    expect(first.weather).toBe("clear");
    await page.screenshot({ path: resolve(output, "1819-desktop.png") });
    metrics.push({ scene: "1819", ...first });
    // The merged cinematic controls must coexist with the same mounted map.
    await page.getByRole("button", { name: "Sound off", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).mapReviewGame.scene.getScene("tiled-map").current.audio.muted)).toBe(false);
    await page.getByRole("button", { name: "Sound on", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).mapReviewGame.scene.getScene("tiled-map").current.audio.muted)).toBe(true);
    await page.getByRole("button", { name: "Role brief", exact: true }).click();
    const roleBrief = page.getByRole("dialog", { name: "Role brief" });
    await roleBrief.waitFor();
    await page.screenshot({ path: resolve(output, "1819-role-brief.png") });
    await roleBrief.getByRole("button", { name: "Back to the map" }).click();
    await roleBrief.waitFor({ state: "detached" });
    expect(await inspect(page)).toEqual(first);
    // Diagnostic evidence only: zoom out to show the whole population in one frame.
    await page.evaluate(() => {
      const scene = (window as any).mapReviewGame.scene.getScene("tiled-map");
      const camera = scene.cameras.main;
      scene.following = false;
      camera.stopFollow(); camera.removeBounds();
      camera.setZoom(Math.min(scene.scale.width / (scene.current.map.width * 16), scene.scale.height / (scene.current.map.height * 16)) * 0.95);
      camera.centerOn(scene.current.map.width * 8, scene.current.map.height * 8);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(output, "1819-population-overview.png") });
    await page.evaluate(() => (window as any).mapReviewGame.scene.getScene("tiled-map").fitCamera());


    // Walk with actual keyboard input through the real map and engine room handler.
    const target = await page.evaluate(() => {
      const scene = (window as any).mapReviewGame.scene.getScene("tiled-map");
      return scene.ambientLife.people()[0].at;
    });
    await walkTo(page, target);
    const before = JSON.stringify(data.golden!.state);
    const beforeActions = actions.length;
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as any).mapReviewGame.scene.getScene("tiled-map");
      return scene.ambientLife.residents.some((r: any) => r.person && r.bubble);
    })).toBe(true);
    expect(JSON.stringify(data.golden!.state)).toBe(before);
    expect(actions.length).toBe(beforeActions);
    await page.screenshot({ path: resolve(output, "1819-street-greeting.png") });

    // Animation works, while reduced motion keeps people/animals in place.
    const residents = () => page.evaluate(() => (window as any).mapReviewGame.scene.getScene("tiled-map").ambientLife.residents.map((r: any) => [r.sprite.x, r.sprite.y]));
    const still = await residents();
    await page.waitForTimeout(350);
    expect(await residents()).toEqual(still);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(residents, { timeout: 8000 }).not.toEqual(still);
    await page.emulateMedia({ reducedMotion: "reduce" });

    const nextDoor = await page.evaluate(() => {
      const scene = (window as any).mapReviewGame.scene.getScene("tiled-map");
      return scene.current.map.doors.find((door: any) => door.roomId !== "landing");
    });
    await walkTo(page, nextDoor.inside);
    await expect.poll(() => data.golden!.state.playerRoomId).toBe(nextDoor.roomId);
    expect(actions).toContain("enterRoom");

    await open("rainy");
    const rain = await inspect(page);
    expect(rain.weather).toBe("rain");
    expect(rain.people).toBe(6);
    expect(rain.uniqueStarts).toBe(rain.people + rain.animals);
    expect(rain.weatherSurface).toBe(true);
    expect(rain.storyContext).toContain("1930");
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(output, "rainy-office-desktop.png") });
    metrics.push({ scene: "rainy office", ...rain });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    expect(await page.locator("h1").count()).toBe(1);
    const talk = await page.getByRole("button", { name: /Press E to talk/ }).boundingBox();
    const documents = await page.getByRole("button", { name: /^Documents/ }).boundingBox();
    expect(talk!.y + talk!.height).toBeLessThanOrEqual(documents!.y);

    await page.screenshot({ path: resolve(output, "rainy-office-mobile.png") });
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight }));
    expect(size.scroll).toBeLessThanOrEqual(size.width);
    expect(size.scrollHeight).toBeLessThanOrEqual(size.height);
    metrics.push({ scene: "mobile", ...size });
    expect(errors).toEqual([]);
    await writeFile(resolve(output, "results.json"), JSON.stringify({ checks: ["public scenery projection", "bundled fixtures", "people and animals", "sound toggle reaches map", "role brief opens and returns to populated map", "keyboard walk", "local E greeting without engine mutation", "animation and reduced motion", "engine room entry", "mobile controls do not overlap", "rain surface", "mobile overflow", "no browser errors"], metrics, actions, errors }, null, 2));
  } finally {
    await browser?.close();
    await vite.close();
  }
}, 120_000);

async function inspect(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).mapReviewGame?.scene.getScene("tiled-map");
    return {
      ready: Boolean(scene?.ambientLife), descriptions: scene?.current.roomDescriptions,
      outdoorProps: scene?.current.map.scenery?.length,
      streetStops: scene?.ambientLife?.stops.length,
      fixtures: scene?.current.landmarks?.length, people: scene?.ambientLife?.people().length,
      animals: scene?.ambientLife?.residents.filter((r: any) => !r.person).length,
      uniqueStarts: new Set(scene?.ambientLife?.residents.map((r: any) => `${r.at.x},${r.at.y}`)).size,
      weather: scene?.current.ambient?.id, storyContext: scene?.current.storyContext,
      weatherSurface: Boolean(scene?.children.getByName("weather-surface")),
    };
  });
}

async function walkTo(page: Page, target: Point) {
  const snapshot = await page.evaluate(() => (window as any).mapReviewGame.scene.getScene("tiled-map").current);
  const player = snapshot.actors.find((a: any) => a.id === "player").position;
  const path = findPath(snapshot.map, snapshot.doors, player, target);
  expect(path).not.toBeNull();
  let from = player;
  await page.locator("canvas").focus();
  for (const point of path!.filter(point => point.x !== player.x || point.y !== player.y)) {
    await page.keyboard.press(point.x > from.x ? "ArrowRight" : point.x < from.x ? "ArrowLeft" : point.y > from.y ? "ArrowDown" : "ArrowUp");
    await expect.poll(() => page.evaluate(() => (window as any).mapReviewGame.scene.getScene("tiled-map").current.actors.find((a: any) => a.id === "player").position)).toEqual(point);
    await page.getByText("Saving…", { exact: true }).waitFor({ state: "hidden" });
    await page.waitForTimeout(170);
    from = point;
  }
}
