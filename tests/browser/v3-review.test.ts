import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import {
  reviewAnchor,
  reviewIndex,
  type ReviewIndexEntry,
  type ReviewTab,
} from "@/lib/v3/review";

// Real review component and app CSS; no database or model is required.
it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === "1")(
  "keeps review tabs stable and navigates the card index at desktop and mobile sizes",
  async () => {
    const spec = AdventureSpec.parse(
      JSON.parse(await readFile("fixtures/golden-1819.json", "utf8")),
    );
    const source = spec.documents[0];
    const supportText = "These articles are agreed by the Datoo Tumungong for himself and on behalf of the Sultan of Johor, and all matters in them shall be settled when the Sultan arrives at Singapoora.";
    const question = (id: string) => ({ id, prompt: `What must wait for the Sultan (${id})?`, options: [{ id: "a", text: "The agreement's remaining matters." }, { id: "b", text: "The first ship's departure." }, { id: "c", text: "The annual payment's cancellation." }], correctOptionId: "a", support: [{ start: source.body.indexOf(supportText), end: source.body.indexOf(supportText) + supportText.length }], explanation: "The final article leaves matters to be settled when the Sultan arrives." });
    source.readingCheck = { discoveryId: "d1-agreement", variants: ["v1", "v2", "v3", "v4"].map(question), recovery: question("recovery"), recoveryDiscoveryIds: ["d1-calcutta"] };
    spec.stages[0].preparation = { characters: { raffles: [{ discoveryIds: ["d1-agreement"], minMet: 1 }] }, decision: [{ discoveryIds: ["d1-agreement", "d1-calcutta"], minMet: 1 }], essentialCharacters: [{ characterId: "raffles", discoveryIds: [spec.discoveries.find((d) => d.stageId === spec.stages[0].id && "characterId" in d.holder && d.holder.characterId === "raffles")!.id] }] };
    spec.characters[0].persona.voice += " " + "long".repeat(5000);
    const ui = await readFile("apps/web/src/components/ui.tsx", "utf8");
    const buttons = ui.slice(
      ui.indexOf("export const button"),
      ui.indexOf("export const control"),
    );
    const root = resolve("apps/web");
    const vite = await createServer({
      configFile: false,
      cacheDir: resolve("node_modules/.vite/v3-review"),
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
          name: "review-test-harness",
          enforce: "pre",
          resolveId(id) {
            if (id === "virtual:review-test") return "\0virtual:review-test";
            if (id.replaceAll("\\", "/").endsWith("/src/components/ui"))
              return "\0review-buttons";
          },
          async load(id) {
            if (id === "\0review-buttons") return buttons;
            if (id === "\0virtual:review-test")
              return (
                await transformWithEsbuild(
                  `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {ReviewScreen} from '/src/app/v3/teacher/[id]/review/review-screen.tsx';
          import '/src/app/globals.css';
          const spec = ${JSON.stringify(spec)};
          createRoot(document.getElementById('root')).render(
            <main className="mx-auto max-w-6xl p-5 md:pb-0">
              <header className="mb-8 h-32"><h1>Review fixture</h1></header>
              <ReviewScreen spec={spec} sources={spec.sources} errors={[{code:'fixture', path:'documents.0.body', message:'Inspect document fixture'}]} warnings={[]} />
            </main>
          );
        `,
                  "review-test.tsx",
                  { loader: "tsx", jsx: "automatic" },
                )
              ).code;
          },
          configureServer(server) {
            server.middlewares.use((request, response, next) => {
              if (request.url !== "/") return next();
              response.setHeader("Content-Type", "text/html");
              response.end(
                '<html style="--font-ui:Arial;--font-record:Georgia"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:review-test"></script></body></html>',
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
      const page = await browser.newPage({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const tabLabels = {
        stages: "Stages",
        characters: "Characters",
        documents: "Documents",
        endings: "Endings",
      } as const;
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 1024, height: 640 },
        { width: 375, height: 812 },
        { width: 320, height: 640 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(vite.resolvedUrls!.local[0]!);
        await page.getByRole("tab", { name: "Stages", exact: true }).waitFor();
        await page
          .getByRole("tablist")
          .evaluate((element) =>
            element.scrollIntoView({ block: "start", behavior: "instant" }),
          );
        expect(
          await page
            .getByRole("tablist")
            .evaluate((element) =>
              Math.abs(element.getBoundingClientRect().top),
            ),
        ).toBeLessThanOrEqual(1);
        if (viewport.width >= 768) {
          // At the end of the page, the tabs and both scrolling panes must fit.
          await page.evaluate(() =>
            window.scrollTo(0, document.documentElement.scrollHeight),
          );
          const bounds = await page.evaluate(() => ({
            tabsTop: document
              .querySelector('[role="tablist"]')!
              .getBoundingClientRect().top,
            detailsBottom: document
              .querySelector('[data-review-scroll]')!
              .getBoundingClientRect().bottom,
            indexBottom: document.querySelector('nav')!.getBoundingClientRect().bottom,
            viewport: innerHeight,
          }));
          expect(bounds.tabsTop).toBeGreaterThanOrEqual(-1);
          expect(bounds.tabsTop).toBeLessThanOrEqual(1);
          expect(bounds.detailsBottom).toBeCloseTo(bounds.viewport - 16, 0);
          expect(bounds.indexBottom).toBeCloseTo(bounds.viewport - 16, 0);
        }
        const panel = page.getByRole("region", { name: "Review details" });
        const dimensions: { height: number; tabs: number; panel: number }[] =
          [];
        for (const [tab, label] of Object.entries(tabLabels)) {
          await page.getByRole("tab", { name: label, exact: true }).click();
          if (tab === "stages") {
            await panel.getByRole("heading", { name: "Preparation and essential conversations", exact: true }).waitFor();
            expect(await panel.getByText("Every essential conversation is required, even when time expires.", { exact: true }).count()).toBe(1);
          }
          if (tab === "documents") {
            await panel.getByRole("heading", { name: "Reading check", exact: true }).waitFor();
            const question = panel.locator("details").filter({ hasText: "Question 1:" });
            expect(await question.getAttribute("open")).toBeNull();
            await question.locator("summary").click();
            expect(await question.getByText("The agreement's remaining matters. (correct)", { exact: true }).count()).toBe(1);
            expect(await question.locator("blockquote").textContent()).toBe(supportText);
            await question.locator("summary").click();
          }
          const navigation = page.getByRole("navigation", {
            name: `${label} items`,
          });
          const owner =
            spec[tab as "stages" | "characters" | "documents" | "endings"][0]
              .id;
          const visit = async (entries: ReviewIndexEntry[]) => {
            for (const entry of entries) {
              await navigation
                .locator(`[aria-controls="${reviewAnchor(entry.id)}"]`)
                .click();
              const target = await page
                .locator(`[id="${reviewAnchor(entry.id)}"]`)
                .evaluate((element) => {
                  const container = element.closest("[data-review-scroll]")!;
                  const item = element.getBoundingClientRect();
                  const bounds = container.getBoundingClientRect();
                  return {
                    focused: document.activeElement === element,
                    visible:
                      item.top < bounds.bottom && item.bottom > bounds.top,
                  };
                });
              expect(target, `${viewport.width}: ${entry.label}`).toEqual({
                focused: true,
                visible: true,
              });
              if (entry.children) await visit(entry.children);
            }
          };
          await visit(reviewIndex(spec, tab as ReviewTab, owner));
          dimensions.push(
            await page.evaluate(() => ({
              height: document.documentElement.scrollHeight,
              tabs: document
                .querySelector('[role="tablist"]')!
                .getBoundingClientRect().height,
              panel: document
                .querySelector("[data-review-scroll]")!
                .getBoundingClientRect().height,
            })),
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          expect(
            await page.evaluate(() =>
              getComputedStyle(document.body)
                .backgroundAttachment.split(",")
                .every((value) => value.trim() === "fixed"),
            ),
          ).toBe(true);
        }
        expect(
          new Set(dimensions.map((d) => d.height)).size,
          `page height at ${viewport.width}`,
        ).toBe(1);
        expect(
          new Set(dimensions.map((d) => d.tabs)).size,
          `tab height at ${viewport.width}`,
        ).toBe(1);
        expect(
          new Set(dimensions.map((d) => d.panel)).size,
          `panel height at ${viewport.width}`,
        ).toBe(1);
        await page.getByRole("tab", { name: "Stages", exact: true }).click();
        const stageIndex = page.getByRole("navigation", {
          name: "Stages items",
        });
        const stageToggle = stageIndex.locator("button[aria-expanded]").first();
        const detailPosition = await panel.evaluate(
          (element) => element.scrollTop,
        );
        await stageToggle.click();
        expect(await stageToggle.getAttribute("aria-expanded")).toBe("false");
        expect(await stageIndex.locator("button[aria-controls]").count()).toBe(
          0,
        );
        expect(await panel.evaluate((element) => element.scrollTop)).toBe(
          detailPosition,
        );
        await stageToggle.click();
        expect(await stageToggle.getAttribute("aria-expanded")).toBe("true");
        expect(
          await stageIndex.locator("button[aria-controls]").count(),
        ).toBeGreaterThan(0);
        // Switching after reading to the bottom must keep the page still and reset only the detail pane.
        await page.getByRole("tab", { name: "Stages", exact: true }).click();
        await panel.evaluate((element) =>
          element.scrollTo({ top: element.scrollHeight, behavior: "instant" }),
        );
        await page
          .getByRole("tab", { name: "Characters", exact: true })
          .scrollIntoViewIfNeeded();
        const pageY = await page.evaluate(() => scrollY);
        await page
          .getByRole("tab", { name: "Characters", exact: true })
          .click();
        expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
        expect(
          await page.evaluate(() => scrollY),
          `page position at ${viewport.width}`,
        ).toBe(pageY);
        await page
          .getByRole("tab", { name: "Characters", exact: true })
          .focus();
        await page.keyboard.press("ArrowRight");
        expect(
          await page
            .getByRole("tab", { name: "Documents", exact: true })
            .getAttribute("aria-selected"),
        ).toBe("true");
        await page
          .getByRole("button", {
            name: "Inspect document fixture",
            exact: true,
          })
          .click();
        expect(await page.locator("mark").count()).toBeGreaterThan(0);
        const headings = await panel.getByRole("heading").allTextContents();
        expect(headings).toContain("Passage 1");
        for (const passage of spec.documents[0].keyPassages) {
          expect(headings).not.toContain(passage.id);
          expect(
            await panel.locator("code").filter({ hasText: passage.id }).count(),
          ).toBeGreaterThan(0);
        }

        for (const theme of ["light", "dark"]) {
          await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
          }, theme);
          const contrast = await page
            .locator("mark")
            .first()
            .evaluate((element) => {
              const css = getComputedStyle(element);
              const luminance = (color: string) => {
                const rgb = color
                  .match(/[\d.]+/g)!
                  .slice(0, 3)
                  .map(Number)
                  .map((value) => {
                    const channel = value / 255;
                    return channel <= 0.04045
                      ? channel / 12.92
                      : ((channel + 0.055) / 1.055) ** 2.4;
                  });
                return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
              };
              const text = luminance(css.color),
                background = luminance(css.backgroundColor);
              return (
                (Math.max(text, background) + 0.05) /
                (Math.min(text, background) + 0.05)
              );
            });
          expect(
            contrast,
            `${theme} highlight contrast`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
  180_000,
);
