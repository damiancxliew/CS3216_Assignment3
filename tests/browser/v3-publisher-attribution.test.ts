import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === "1")("shows the actual publisher per published version in the history dialog", async () => {
  const ui = readFileSync("apps/web/src/components/ui.tsx", "utf8");
  const buttons = ui.slice(ui.indexOf("export const button"), ui.indexOf("export const control"));
  const date = "2026-10-27T01:00:00.000Z";
  const publication = (version: number, name: string | null) => ({ version, linkKey: `release-${version}`, firstPublishedAt: date, lastPublishedAt: date, publishedBy: name ? `staff-${version}` : null, publisherName: name });
  const versions = [4, 3, 2, 1].map(version => ({ version, title: `Adventure revision ${version}`, createdAt: date, attempts: 0, linkKey: version === 4 ? null : `release-${version}`, publication: version === 4 ? null : publication(version, version === 3 ? "Ms Wong" : version === 2 ? "Mr Tan" : null) }));
  const root = resolve("apps/web");
  const server = await createServer({ configFile: false, root, cacheDir: resolve("node_modules/.vite/publisher-attribution"),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    optimizeDeps: { include: ["react", "react-dom/client"] },
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") }, dedupe: ["react", "react-dom"] },
    plugins: [{ name: "publisher-harness", enforce: "pre", resolveId(id) {
      if (id === "virtual:publisher") return "\0publisher";
      if (id === "next/link") return "\0link";
      if (id === "next/navigation") return "\0navigation";
      if (id.endsWith("/version-actions")) return "\0versions";
      if (id.endsWith("/publish-actions")) return "\0publish";
      if (id.endsWith("/teacher/import-actions")) return "\0import";
      if (id.endsWith("/src/components/ui")) return "\0ui";
      if (id.endsWith("/action-form")) return "\0form";
    }, async load(id) {
      if (id === "\0link") return `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`;
      if (id === "\0navigation") return `export const useRouter=()=>({refresh(){}});export const useSearchParams=()=>new URLSearchParams()`;
      if (id === "\0versions") return `export const getV3SavedVersions=async()=>(${JSON.stringify({ ok: true, latest: 4, publishedVersion: 3, published: true, versions })})`;
      if (id === "\0publish") return `export const publishSavedV3Version=async()=>({ok:true})`;
      if (id === "\0import") return `export const updateAdventureFromZip=async()=>({})`;
      if (id === "\0form") return `export const ActionForm=()=>null`;
      if (id === "\0ui") return `${buttons}`;
      if (id === "\0publisher") return (await transformWithEsbuild(`
        import React from 'react';import{createRoot}from'react-dom/client';
        import{AdventureVersions}from'@/components/teacher/v3-version-controls';import'@/app/globals.css';
        createRoot(document.getElementById('root')).render(<main className="p-4"><AdventureVersions adventureId="game"/></main>);
      `, "publisher-harness.tsx", { loader: "tsx", jsx: "automatic" })).code;
    }, configureServer(vite) { vite.middlewares.use((req,res,next) => {
      if(req.url?.split('?')[0]!=="/") return next();
      res.setHeader("Content-Type","text/html");res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__publisher"></script></body></html>');
    }); } }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ headless: true });
    mkdirSync("output/publisher-attribution", { recursive: true });
    for (const width of [1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = [];page.on("pageerror",error => errors.push(error.message));
      await page.goto(server.resolvedUrls!.local[0]!);
      await page.getByRole("button",{name:"Versions",exact:true}).click();
      const dialog = page.getByRole("dialog",{name:"Adventure versions"});
      await dialog.getByText("Last published by Ms Wong",{exact:false}).waitFor();
      const rows = dialog.getByRole("listitem");
      expect(await rows.nth(0).textContent()).not.toContain("published by");
      expect(await rows.nth(1).textContent()).toContain("Last published by Ms Wong");
      expect(await rows.nth(2).textContent()).toContain("Last published by Mr Tan");
      expect(await rows.nth(3).textContent()).toContain("Publisher not recorded");
      expect(await dialog.locator("time[datetime='"+date+"']").count()).toBe(7);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/publisher-attribution/${width}.png` });
      await page.keyboard.press("Escape");
      expect(await dialog.isVisible()).toBe(false);
      expect(errors).toEqual([]);await page.close();
    }
  } finally { await browser?.close();await server.close(); }
},60_000);
