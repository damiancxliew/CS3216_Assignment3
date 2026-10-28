import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === "1")("offers ZIP and JSON updates in the import/export dialog", async () => {
  const ui = readFileSync("apps/web/src/components/ui.tsx", "utf8");
  const buttons = ui.slice(ui.indexOf("export const button"), ui.indexOf("export const control"));
  const root = resolve("apps/web");
  const server = await createServer({ configFile: false, root, cacheDir: resolve("node_modules/.vite/v3-transfer"),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    optimizeDeps: { include: ["react", "react-dom/client"] }, esbuild: { jsx: "automatic" },
    css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") }, dedupe: ["react", "react-dom"] },
    plugins: [{ name: "transfer-harness", enforce: "pre", resolveId(id) {
      if (id === "virtual:transfer") return "\0transfer";
      if (id.endsWith("/teacher/import-actions")) return "\0import";
      if (id.endsWith("/src/components/ui")) return "\0ui";
      if (id.endsWith("/analytics/posthog")) return "\0analytics";
    }, async load(id) {
      if (id === "\0analytics") return `export const track=()=>{}`;
      if (id === "\0import") return `export const updateAdventureFromFile=async(id,version,published,previous,form)=>({error:'Received '+form.get('file').name+' for '+id+' version '+(version+1)});`;
      if (id === "\0ui") return (await transformWithEsbuild(`${buttons}
        export function StableLabel({label}){return <>{label}</>}
        export function Pending({children}){return <>{children}</>}
        export function ErrorText({children}){return <p role="alert">{children}</p>}
      `, "controls.tsx", { loader: "tsx", jsx: "automatic" })).code;
      if (id === "\0transfer") return (await transformWithEsbuild(`
        import React from 'react';import{createRoot}from'react-dom/client';
        import{AdventureTransfer}from'@/components/teacher/v3-version-controls';import'@/app/globals.css';
        createRoot(document.getElementById('root')).render(<main className="p-4"><AdventureTransfer adventureId="story" version={2} publishedVersion={1}/></main>);
      `, "transfer.tsx", { loader: "tsx", jsx: "automatic" })).code;
    }, configureServer(vite) { vite.middlewares.use((req,res,next) => {
      if(req.url?.split('?')[0]!=="/") return next();
      res.setHeader("Content-Type","text/html");res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__transfer"></script></body></html>');
    }); } }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ headless: true });
    mkdirSync("output/v3-transfer", { recursive: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(server.resolvedUrls!.local[0]!);
      await page.getByRole("button", { name: "Import / export", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Import and export", exact: true });
      const file = dialog.getByLabel("Adventure ZIP or JSON", { exact: true });
      expect(await file.getAttribute("accept")).toBe(".zip,.json,application/zip,application/json");
      expect(await dialog.textContent()).toContain("Version 1 stays live.");
      for (const extension of ["json", "zip"]) {
        await file.setInputFiles({ name: `update.${extension}`, mimeType: `application/${extension}`, buffer: Buffer.from("fixture") });
        await dialog.getByRole("button", { name: "Import as new version", exact: true }).click();
        await dialog.getByRole("alert").filter({ hasText: `Received update.${extension} for story version 3` }).waitFor();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/v3-transfer/${width}.png` });
      await page.keyboard.press("Escape");
      expect(await dialog.isVisible()).toBe(false);
      expect(errors).toEqual([]);
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
}, 60_000);
