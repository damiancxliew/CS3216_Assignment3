import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === "1")("shows publishers and copies release links on the history page at desktop and mobile widths", async () => {
  const ui = readFileSync("apps/web/src/components/ui.tsx", "utf8");
  const buttons = ui.slice(ui.indexOf("export const button"), ui.indexOf("export const control"));
  const date = "2026-10-27T01:00:00.000Z";
  const rows = [3, 2, 1].map(version => ({ version, id: `release-${version}`, adventureId: "fixture", title: `Adventure revision ${version}`, firstPublishedAt: date, lastPublishedAt: date, publishedBy: version > 1 ? `staff-${version}` : null, publisherName: version === 3 ? "Ms Wong" : version === 2 ? "Mr Tan" : null, live: version === 3, started: 0, inProgress: 0, completed: 0 }));
  const root = resolve("apps/web");
  const server = await createServer({ configFile: false, root, cacheDir: resolve("node_modules/.vite/publisher-attribution"),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    optimizeDeps: { include: ["react", "react-dom/client"] },
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") }, dedupe: ["react", "react-dom"] },
    plugins: [{ name: "publisher-harness", enforce: "pre", resolveId(id) {
      if (id === "virtual:publisher") return "\0publisher";
      if (id.endsWith("/v3/flag")) return "\0flag";
      if (id === "next/link") return "\0link";
      if (id === "next/headers") return "\0headers";
      if (id === "next/navigation") return "\0navigation";
      if (id.endsWith("/lib/supabase/server")) return "\0auth";
      if (id.endsWith("/play/v3/http")) return "\0deps";
      if (id.endsWith("/play/v3/publication-history")) return "\0history";
      if (id === "./adventure-access-actions") return "\0access";
      if (id.endsWith("/components/ui")) return "\0ui";
    }, async load(id) {
      if (id === "\0flag") return `export const v3Enabled=()=>true`;
      if (id === "\0link") return `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`;
      if (id === "\0navigation") return `export function notFound(){throw Error('not found')} export function redirect(){throw Error('redirect')}`;
      if (id === "\0headers") return `export const headers=async()=>new Map([['host',location.host],['x-forwarded-proto','http']])`;
      if (id === "\0auth") return `export const createClient=async()=>({auth:{getUser:async()=>({data:{user:{id:'teacher'}}})}})`;
      if (id === "\0deps") return `export const v3PublishDeps=()=>({})`;
      if (id === "\0history") return `export const loadPublicationHistory=async()=>(${JSON.stringify({adventure:{status:"published",isPublic:false},rows})})`;
      if (id === "\0access") return `export const setAdventurePublic=async()=>({ok:true})`;
      if (id === "\0ui") return `import React from 'react';${buttons};export function Page({title,children}){return React.createElement('main',{className:'p-4 space-y-4'},React.createElement('h1',null,title),children)}`;
      if (id === "\0publisher") return (await transformWithEsbuild(`
        import React from 'react';import{createRoot}from'react-dom/client';
        import HistoryPage from '@/app/v3/teacher/[id]/links/page';import'@/app/globals.css';
        HistoryPage({params:Promise.resolve({id:'fixture'})}).then(page=>createRoot(document.getElementById('root')).render(page));
      `, "publisher-harness.tsx", { loader: "tsx", jsx: "automatic" })).code;
    }, configureServer(vite) { vite.middlewares.use((req,res,next) => {
      if(req.url?.split('?')[0]!=="/") return next();
      res.setHeader("Content-Type","text/html");res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__publisher"></script></body></html>');
    }); } }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ headless: true });
    for (const width of [1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = [];page.on("pageerror",error => errors.push(error.stack || error.message));
      await page.goto(server.resolvedUrls!.local[0]!);
      await page.getByRole("heading",{name:"Version history",exact:true}).waitFor({timeout:5000}).catch(error=>{throw new Error(`${error.message}; browser errors: ${errors.join("; ")}`)});
      const entries = width >= 768 ? page.getByRole('row').filter({has:page.getByRole('cell')}) : page.getByRole('article');
      expect(await entries.count()).toBe(3);
      expect(await entries.nth(0).textContent()).toContain("Last published by Ms Wong");
      expect(await entries.nth(1).textContent()).toContain("Last published by Mr Tan");
      expect(await entries.nth(2).textContent()).toContain("Publisher not recorded");
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      for (const [index, version] of [[0, 3], [1, 2], [2, 1]]) {
        await entries.nth(index).getByRole("button", { name: "Copy link", exact: true }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/v3/join/release-${version}`, server.resolvedUrls!.local[0]).href);
      }
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/publisher-history-${width}.png` });
      expect(errors).toEqual([]);await page.close();
    }
  } finally { await browser?.close();await server.close(); }
},60_000);
