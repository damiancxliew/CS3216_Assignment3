import { resolve } from "node:path";

import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_CINEMATIC_BROWSER_TESTS === "1")(
  "advances cinematic beats, falls back from failed art, begins, and closes Role brief",
  async () => {
    const root = resolve("apps/web");
    const vite = await createServer({
      configFile: false,
      cacheDir: resolve("node_modules/.vite/v3-cinematic"),
      root,
      publicDir: false,
      server: {
        host: "127.0.0.1",
        port: 0,
        watch: null,
        fs: { allow: [resolve(".")] },
      },
      esbuild: { jsx: "automatic" },
      optimizeDeps: { include: ["react", "react-dom/client"] },
      css: { postcss: { plugins: [tailwind()] } },
      resolve: { alias: { "@": resolve(root, "src") } },
      plugins: [
        {
          name: "cinematic-test-harness",
          enforce: "pre",
          resolveId(id) {
            if (id === "virtual:cinematic-test") return "\0virtual:cinematic-test";
          },
          async load(id) {
            if (id === "\0virtual:cinematic-test") {
              return (
                await transformWithEsbuild(
                  `
          import React, {useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {V3Cinematic} from '/src/components/play/v3/v3-cinematic.tsx';
          const beats = [
            {id:'role', kicker:'Your role', title:'Ahmad', body:'Interpreter'},
            {id:'question', kicker:'The question', body:'Who will shape the island?'}
          ];
          function App() {
            const [started, setStarted] = useState(false);
            const [roleBriefOpen, setRoleBriefOpen] = useState(false);
            return <main>
              <button onClick={() => setRoleBriefOpen(true)}>Role brief</button>
              <p>{started ? 'Started' : 'Not started'}</p>
              {!started ? <V3Cinematic artUrl="/broken.webp" beats={beats} beginLabel="Enter the first stage" onBegin={() => setStarted(true)} muted={true} onToggleMuted={() => {}} /> : null}
              {roleBriefOpen ? <V3Cinematic artUrl={null} beats={beats} beginLabel="Back to the map" onBegin={() => setRoleBriefOpen(false)} onClose={() => setRoleBriefOpen(false)} muted={true} onToggleMuted={() => {}} initiallySettled /> : null}
            </main>;
          }
          createRoot(document.getElementById('root')).render(<App />);
        `,
                  "cinematic-test.tsx",
                  { loader: "tsx", jsx: "automatic" },
                )
              ).code;
            }
          },
          configureServer(server) {
            server.middlewares.use((request, response, next) => {
              if (request.url !== "/") return next();
              response.setHeader("Content-Type", "text/html");
              response.end(
                '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:cinematic-test"></script></body></html>',
              );
            });
          },
        },
      ],
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await vite.listen();
      browser = await chromium.launch({
        headless: true,
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      });
      const page = await browser.newPage({ reducedMotion: "no-preference" });
      await page.route("**/broken.webp", (route) => route.abort());
      await page.goto(vite.resolvedUrls!.local[0]!);

      const opening = page.getByRole("dialog", { name: "Adventure opening" });
      await opening.waitFor();
      expect(await opening.locator('[data-active="true"]').count()).toBe(1);
      expect(await opening.locator('[data-active="false"]').count()).toBe(1);
      await opening.locator("img").waitFor({ state: "detached" });
      expect(await opening.locator("img").count()).toBe(0);
      expect(await opening.locator("div").first().evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("radial-gradient");

      await opening.getByRole("button", { name: "Skip" }).click();
      expect(await opening.getAttribute("data-phase")).toBe("told");
      await opening.getByRole("button", { name: "Enter the first stage" }).click();
      await page.getByText("Started", { exact: true }).waitFor();

      await page.getByRole("button", { name: "Role brief" }).click();
      const roleBrief = page.getByRole("dialog", { name: "Role brief" });
      await roleBrief.waitFor();
      await roleBrief.getByRole("button", { name: "Back to the map" }).click();
      await roleBrief.waitFor({ state: "detached" });

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload();
      await page.getByRole("button", { name: "Enter the first stage" }).waitFor();
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
);
