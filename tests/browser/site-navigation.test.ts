import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_HEADER_BROWSER_TESTS === "1")("collapses role navigation without overflowing and supports keyboard dismissal", async () => {
  const root = resolve("apps/web");
  const output = resolve("output/site-navigation");
  await mkdir(output, { recursive: true });
  const vite = await createServer({ configFile: false, root, publicDir: false, cacheDir: resolve("node_modules/.vite/site-navigation"),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") }, dedupe: ["react", "react-dom"] },
    define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("http://localhost:54321"), "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("fixture") },
    plugins: [{ name: "header-fixture", enforce: "pre", resolveId(id, importer) {
      if (id === "virtual:header") return "\0header";
      if (id === "next/link") return "\0link";
      if (id === "next/navigation") return "\0navigation";
      const absolute = id.startsWith(".") && importer ? resolve(dirname(importer), id) : id;
      if (absolute.endsWith("/lib/supabase/client")) return "\0auth";
    }, async load(id) {
      if (id === "\0link") return "import React from 'react';export default function Link(props){return React.createElement('a',props)}";
      if (id === "\0navigation") return "export function usePathname(){return '/v3/teacher/fixture'}";
      if (id === "\0auth") return `export function createClient(){return {auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session:{user:{id:'fixture',email:'teacher@local.test',user_metadata:{full_name:'A teacher with a deliberately long display name'}}}}}}},from(table){return {select(){return this},eq(){return this},async maybeSingle(){return {data:table==='platform_admin'?{user_id:'fixture'}:{role:'admin',organization:{name:'A school with a deliberately long name',slug:'test-school'}}}}}}}}`;
      if (id === "\0header") return (await transformWithEsbuild(`import React from 'react';import {createRoot} from 'react-dom/client';import {SiteHeader} from '/src/components/ui.tsx';import {ThemeProvider} from '/src/components/theme-provider.tsx';import '/src/app/globals.css';createRoot(document.getElementById('root')).render(<ThemeProvider><SiteHeader/></ThemeProvider>);`, "header.tsx", { loader: "tsx", jsx: "automatic" })).code;
    }, configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__header"></script></body></html>');
    }); } }],
  });
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const results = [];
  try {
    await vite.listen();
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(vite.resolvedUrls!.local[0]!);
    await page.getByRole("button", { name: /Signed in as/ }).waitFor();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 1280, 1024, 800, 640, 375, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const trigger = nav.getByRole("button", { name: "Navigation", exact: true });
        const collapsed = await trigger.isVisible();
        expect(collapsed).toBe(width <= 1024);
        const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, header: document.querySelector("header")!.getBoundingClientRect().height }));
        expect(size.scroll).toBe(size.client);
        expect(size.header).toBeLessThanOrEqual(80);
        if (collapsed) {
          await trigger.focus();
          await page.keyboard.press("Enter");
          const panel = await page.locator("#navigation-links").boundingBox();
          expect(panel!.x).toBeGreaterThanOrEqual(0);
          expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
          for (const label of ["Home", "Console", "School", "Admin"]) expect(await nav.getByRole("link", { name: label, exact: true }).isVisible()).toBe(true);
          expect(await nav.getByRole("link", { name: "School", exact: true }).locator("svg").count()).toBe(1);
          expect(await nav.getByRole("link", { name: "Console", exact: true }).getAttribute("aria-current")).toBe("page");
          await page.keyboard.press("Tab");
          expect(await nav.getByRole("link", { name: "Home", exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
          await page.screenshot({ path: `${output}/${width}-${theme}.png` });
          await page.keyboard.press("Escape");
          expect(await trigger.getAttribute("aria-expanded")).toBe("false");
          expect(await trigger.evaluate(node => node === document.activeElement)).toBe(true);
          await trigger.click();
          await page.mouse.click(5, 200);
          expect(await trigger.getAttribute("aria-expanded")).toBe("false");
        } else {
          expect(await nav.getByRole("link", { name: "School", exact: true }).locator("svg").count()).toBe(1);
          await page.screenshot({ path: `${output}/${width}-${theme}.png` });
        }
        await page.getByRole("button", { name: /Signed in as/ }).click();
        const accountPanel = await page.getByRole("menu", { name: "Account", exact: true }).boundingBox();
        expect(accountPanel!.x).toBeGreaterThanOrEqual(0);
        expect(accountPanel!.x + accountPanel!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
        results.push({ width, theme, collapsed, ...size });
      }
    }
    expect(errors).toEqual([]);
    await writeFile(`${output}/verification.json`, JSON.stringify({ results, browserErrors: errors }, null, 2));
  } finally { await browser.close(); await vite.close(); }
}, 60000);
