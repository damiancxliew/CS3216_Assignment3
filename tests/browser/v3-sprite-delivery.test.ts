import { createServer as httpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer as viteServer } from "vite";
import { expect, it, vi } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { compileV3StageMap } from "@/lib/play/v3/map";
import { v3AdventureScenery } from "@/lib/play/v3/scenery";

// Storage is the only replaced boundary: download the public object from a real
// second origin with no CORS headers. The actual route and Phaser renderer run.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/assets/store", () => ({ createAssetStore: () => ({
  download: async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
}) }));
import { GET } from "@/app/api/v3/sprites/[...path]/route";

it.runIf(process.env.RUN_SPRITE_DELIVERY_BROWSER_TESTS === "1")(
  "displays a CDN image in review, reproduces Phaser CORS fallback, then renders it through same-origin delivery",
  async () => {
    const path = `00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/${"a".repeat(64)}.png`;
    const bytes = await readFile(process.env.SPRITE_SHEET_FILE ?? "apps/web/public/game/ninja/characters/Noble/walk.png");
    const cdn = httpServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(bytes);
    });
    await new Promise<void>(resolve => cdn.listen(0, "127.0.0.1", resolve));
    const address = cdn.address();
    if (!address || typeof address === "string") throw Error("Fixture CDN did not start");
    const base = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("ASSET_BUCKET", "fixture"); vi.stubEnv("ASSET_PUBLIC_BASE_URL", base);
    const source = `${base}/v3/media/${path}`;
    const spec = AdventureSpec.parse(JSON.parse(await readFile("fixtures/golden-1819.json", "utf8")));
    spec.authoring = { walkingSprites: { player: { type: "custom", fallback: "Boy", candidate: {
      candidateId: "00000000-0000-4000-8000-000000000002", origin: "ai", url: source, format: "png",
      caption: "Elizabeth Choy", alt: "Walking sheet", credit: "AI-generated illustration", spriteLayout: "4x4-down-up-left-right",
    } } } };
    const scenery = v3AdventureScenery(spec)[0];
    const selected = scenery.walkingSprites!.player;
    expect(selected.spriteSheetUrl).toBe(`/api/v3/sprites/${path}`);
    const stage = spec.stages[0];
    const compiled = compileV3StageMap("sprite-cors", "stage-0", 0, stage.rooms, stage.rooms[0].id);
    const snapshot = {
      seed: "sprite-cors", map: compiled.map, doors: compiled.initialDoors,
      actors: [{ id: "player", name: "Elizabeth Choy", position: compiled.playerSpawn, space: null, targetRoomId: null,
        status: "idle", sprite: "Boy", spriteSheetUrl: source }],
      playerGoal: null, playerStatus: "idle", running: true, npcRoutes: false, revision: 0, audio: { muted: true },
    };
    const vite = await viteServer({
      configFile: false, root: resolve("apps/web"), publicDir: resolve("apps/web/public"),
      cacheDir: resolve("node_modules/.vite/sprite-delivery"),
      server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
      optimizeDeps: { include: ["phaser"] },
      css: { postcss: { plugins: [] } },
      plugins: [{
        name: "sprite-delivery-fixture",
        resolveId(id) { if (id === "virtual:sprite") return "\0sprite"; },
        load(id) {
          if (id !== "\0sprite") return;
          return `import Phaser from 'phaser';
            import {createTiledMapView} from '@adventure/game-client/tiled-view';
            const boot = Phaser.Game.prototype.boot;
            Phaser.Game.prototype.boot = function() { window.spriteGame = this; boot.call(this); };
            const snapshot = ${JSON.stringify(snapshot)};
            const view = await createTiledMapView(document.getElementById('map'),snapshot,()=>{},true,{assetBase:'/game/ninja'});
            window.spriteReady = true;
            document.getElementById('fix').onclick = () => view.render({...snapshot,actors:[{...snapshot.actors[0],spriteSheetUrl:${JSON.stringify(selected.spriteSheetUrl)}}]});`;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url === "/") {
              response.setHeader("Content-Type", "text/html");
              response.end(`<img alt="Saved walking sheet" src="${source}"><button id="fix">Use same-origin sheet</button><div id="map" style="height:80vh;position:relative"></div><script type="module" src="/@id/__x00__sprite"></script>`);
            } else if (request.url?.startsWith("/api/v3/sprites/")) {
              const result = await GET(new Request(`http://localhost${request.url}`), { params: Promise.resolve({ path: request.url.slice("/api/v3/sprites/".length).split("/") }) });
              response.writeHead(result.status, Object.fromEntries(result.headers));
              response.end(Buffer.from(await result.arrayBuffer()));
            } else next();
          });
        },
      }],
    });
    let browser;
    try {
      await vite.listen();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      const errors: string[] = [], consoleErrors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await page.goto(vite.resolvedUrls!.local[0]);
      await page.waitForFunction(() => (window as any).spriteReady === true);
      expect(await page.getByAltText("Saved walking sheet").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(64);
      const texture = () => page.evaluate(() => (window as any).spriteGame.scene.getScene("tiled-map").markers.get("player").sprite.texture.key);
      expect(await texture()).toBe("char-Boy");
      expect(consoleErrors.some(message => message.includes("CORS") && message.includes("Access-Control-Allow-Origin"))).toBe(true);
      await page.getByRole("button", { name: "Use same-origin sheet" }).click();
      await expect.poll(texture, { timeout: 10000 }).toMatch(/^asset-/);
      const frames = await page.evaluate(() => {
        const scene = (window as any).spriteGame.scene.getScene("tiled-map");
        const sprite = scene.markers.get("player").sprite;
        return { width: sprite.frame.width, height: sprite.frame.height, face: scene.anims.get(`${sprite.texture.key}-down`).frames.map((frame: any) => String(frame.textureFrame)) };
      });
      expect(frames).toEqual({ width: 16, height: 16, face: ["0", "4", "8", "12"] });
      expect(errors).toEqual([]);
      await page.screenshot({ path: "/tmp/sprite-cors-fixed.png" });
    } finally {
      await browser?.close(); await vite.close();
      await new Promise<void>(resolve => cdn.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  }, 60000,
);
