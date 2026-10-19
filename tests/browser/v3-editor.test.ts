import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === "1")(
  "edits across tabs, saves/reloads, discards and preserves work on server errors",
  async () => {
    const spec = JSON.parse(
      await readFile("fixtures/golden-1819.json", "utf8"),
    );
    const ui = await readFile("apps/web/src/components/ui.tsx", "utf8");
    const buttons = ui.slice(
      ui.indexOf("export const button"),
      ui.indexOf("export const control"),
    );
    const root = resolve("apps/web");
    const vite = await createServer({
      configFile: false,
      root,
      publicDir: false,
      server: {
        host: "127.0.0.1",
        port: 0,
        watch: null,
        fs: { allow: [resolve(".")] },
      },
      esbuild: { jsx: "automatic" },
      optimizeDeps: {
        include: ["react", "react-dom/client", "@radix-ui/react-select"],
      },
      css: { postcss: { plugins: [tailwind()] } },
      resolve: {
        alias: { "@": resolve(root, "src") },
        dedupe: ["react", "react-dom"],
      },
      plugins: [
        {
          name: "editor-harness",
          enforce: "pre",
          resolveId(id) {
            if (id === "virtual:editor") return "\0editor";
            if (id === "next/link") return "\0link";
            if (id.endsWith("/src/components/ui")) return "\0buttons";
            if (id.endsWith("/edit-actions")) return "\0save";
            if (id.endsWith("/publish-actions")) return "\0publish";
          },
          async load(id) {
            if (id === "\0buttons") return buttons;
            if (id === "\0link")
              return `import React from 'react'; export default function Link(props) { return React.createElement('a', props); }`;
            if (id === "\0publish")
              return `export async function currentV3StudentLink(){return {ok:true,path:"/v3/join/fixture?release=test"}}; export async function publishV3Adventure(){return {ok:true,status:'published'}}; export async function unpublishV3Adventure(){return {ok:true,status:'draft'}}`;
            if (id === "\0save")
              return `import {applyV3Edits} from '/src/lib/v3/edit/commands.ts';
          export async function saveV3AdventureEdits(id,version,edits){
            if(window.saveMode==='failure') throw Error('offline');
            if(window.saveMode==='conflict') return {ok:false,code:'conflict',message:'This adventure changed. Your local edits are still here.'};
            const spec=applyV3Edits(JSON.parse(localStorage.getItem('spec')),edits,[]);
            localStorage.setItem('spec',JSON.stringify(spec)); localStorage.setItem('version',String(version+1));
            return {ok:true,spec,version:version+1,errors:[],warnings:[]};
          }`;
            if (id === "\0editor")
              return (
                await transformWithEsbuild(
                  `
          import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdventureSpec} from '@adventure/spec-v3';
          import {EditorWorkspace} from '/src/app/v3/teacher/[id]/review/editor-workspace.tsx'; import '/src/app/globals.css';
          if(!localStorage.getItem('spec')) localStorage.setItem('spec',${JSON.stringify(JSON.stringify(spec))});
          const spec=AdventureSpec.parse(JSON.parse(localStorage.getItem('spec'))); localStorage.setItem('spec',JSON.stringify(spec));
          createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-5"><EditorWorkspace adventureId="fixture" initial={spec} initialVersion={Number(localStorage.getItem('version')||1)} publishedVersion={null} published={false} sources={spec.sources} capturedSources={[]} errors={[]} warnings={[]} /></main>);
        `,
                  "editor.tsx",
                  { loader: "tsx", jsx: "automatic" },
                )
              ).code;
          },
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url !== "/") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__editor"></script></body></html>',
              );
            });
          },
        },
      ],
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await vite.listen();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error(e.message);
      });
      page.on("console", (m) => {
        if (m.type() === "error") console.error(m.text());
      });
      await page.goto(vite.resolvedUrls!.local[0]!);
      expect(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("button", { name: "Discard edits", exact: true })
          .count(),
      ).toBe(0);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Defining Moment", exact: true })
        .first()
        .click();
      const option = page.getByRole("option", {
        name: spec.definingMoments[0].scene,
        exact: true,
      });
      await option.waitFor();
      expect(await option.innerText()).toBe(spec.definingMoments[0].scene);
      expect(
        await option.evaluate(
          (e) => getComputedStyle(e.querySelector("span")!).whiteSpace,
        ),
      ).toBe("normal");
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(
        await page
          .getByRole("button", { name: "Discard edits", exact: true })
          .isVisible(),
      ).toBe(true);
      expect(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
      ).toBe(0);
      await page.locator("#edit-title").fill("A saved teacher title");
      expect(
        await page.getByRole("button", { name: "Edit", exact: true }).count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("button", { name: "Preview", exact: true })
          .isDisabled(),
      ).toBe(true);
      await page.getByRole("tab", { name: "Characters", exact: true }).click();
      await page
        .locator("#edit-characters-0-persona-voice")
        .fill("A changed teacher voice");
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Saved version 2" })
        .waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      await page.locator("#edit-title").fill("Unsaved");
      page.once("dialog", (d) => d.dismiss());
      await page.getByRole("link", { name: "Back to adventures" }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("Unsaved");
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Discard edits", exact: true })
        .click();
      expect(
        await page
          .getByRole("button", { name: "Edit", exact: true })
          .isVisible(),
      ).toBe(true);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      for (const mode of ["failure", "conflict"]) {
        await page.locator("#edit-title").fill("Keep this local work");
        await page.evaluate((m) => {
          (window as unknown as { saveMode: string }).saveMode = m;
        }, mode);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.getByRole("alert").waitFor();
        expect(await page.locator("#edit-title").inputValue()).toBe(
          "Keep this local work",
        );
        expect(
          await page
            .getByRole("button", { name: "Reload saved version" })
            .isVisible(),
        ).toBe(true);
      }
      for (const width of [1440, 375, 320]) {
        await page.setViewportSize({ width, height: 812 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.getByRole("tab", { name: "Settings", exact: true }).focus();
        await page.keyboard.press("ArrowRight");
        expect(
          await page
            .getByRole("tab", { name: "Reveal and questions" })
            .getAttribute("aria-selected"),
        ).toBe("true");
        await page.getByRole("tab", { name: "Settings", exact: true }).click();
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "/tmp/v3-editor-toolbar-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({
        path: "/tmp/v3-editor-toolbar-mobile.png",
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
  90_000,
);
