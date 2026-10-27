import { resolve } from "node:path";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import { expect, it } from "vitest";

// Isolated UI check; real authorization/admission is covered by API and DB tests.
it.runIf(process.env.RUN_PUBLIC_ACCESS_BROWSER_TESTS === "1")("saves public access and keeps the previous choice on failure at desktop and mobile widths", async () => {
  const root = resolve("apps/web");
  const vite = await createServer({
    configFile: false, root, publicDir: false, cacheDir: "/tmp/public-access-vite-cache",
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" },
    optimizeDeps: { include: ["react", "react-dom/client"] },
    css: { postcss: { plugins: [tailwind()] } },
    plugins: [{
      name: "public-access-harness", enforce: "pre",
      resolveId(id) {
        if (id === "./adventure-access-actions") return "\0access-action";
        if (id === "virtual:public-access") return "\0virtual:public-access";
      },
      async load(id) {
        if (id === "\0access-action") return `export async function setAdventurePublic() {
          await new Promise(resolve => setTimeout(resolve, 100));
          return {ok: !new URLSearchParams(location.search).has('fail')};
        }`;
        if (id !== "\0virtual:public-access") return;
        return (await transformWithEsbuild(`
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {AdventureAccess} from '/src/components/teacher/adventure-access.tsx';
          import '/src/app/globals.css';
          createRoot(document.getElementById('root')).render(<main className="p-6 max-w-3xl mx-auto"><AdventureAccess adventureId="test" kind="v3" isPublic={false} /></main>);
        `, "public-access.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/") return next();
          response.setHeader("Content-Type", "text/html");
          response.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:public-access"></script></body></html>');
        });
      },
    }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await vite.listen();
    browser = await chromium.launch({ headless: true });
    for (const width of [1280, 375, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(vite.resolvedUrls!.local[0]!);
      const select = page.getByRole("combobox", { name: "Who can play" });
      await select.selectOption("public", { timeout: 10000 }).catch(async error => { throw new Error(`${error.message}; page errors: ${errors.join("; ")}; body: ${await page.locator("body").innerText()}`); });
      await page.getByText(/Once published, anyone with the link/).waitFor();
      expect(await select.inputValue()).toBe("public");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/public-access-${width}.png` });
      await page.goto(`${vite.resolvedUrls!.local[0]}?fail`);
      await select.selectOption("public");
      await page.getByRole("alert").waitFor();
      expect(await select.inputValue()).toBe("school");
      expect(errors).toEqual([]);
      await page.close();
    }
  } finally {
    await browser?.close();
    await vite.close();
  }
}, 60_000);
