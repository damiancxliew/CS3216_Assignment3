import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// Run against `next build && next start`, not Vite: CSS extraction is part of the contract.
it.runIf(process.env.RUN_HEADER_PRODUCTION_TESTS === "1")("loads shared header styles on production entry routes", async () => {
  const origin = process.env.HEADER_PRODUCTION_ORIGIN ?? "http://127.0.0.1:3239";
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw Error("Local production server only");
  const output = resolve("output/site-header-production");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const path of ["/", "/teacher"]) {
      const page = await browser.newPage();
      try {
        await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
        const header = page.locator("header").first();
        const nav = header.getByRole("navigation", { name: "Main navigation" });
        if (path === "/") {
          await header.getByRole("link", { name: "Book a demo", exact: true }).waitFor();
          expect(await header.getByRole("link", { name: "Teacher console", exact: true }).count()).toBe(0);
          expect(await nav.getByRole("link", { name: "Console", exact: true }).count()).toBe(0);
          expect(await nav.getByRole("link", { name: "School", exact: true }).count()).toBe(0);
        }
        for (const width of [1440, 1280, 1024, 800, 375, 320]) {
          await page.setViewportSize({ width, height: 800 });
          const toggle = nav.getByRole("button", { name: "Navigation", exact: true });
          const collapsed = width <= 1024;
          expect(await toggle.isVisible()).toBe(collapsed);
          expect(await nav.getByRole("link", { name: "Home", exact: true }).isVisible()).toBe(!collapsed);
          if (collapsed) {
            await toggle.click();
            const panel = page.locator("#navigation-links");
            await panel.waitFor();
            expect(await nav.getByRole("link", { name: "Home", exact: true }).count()).toBe(1);
            expect(await panel.evaluate(node => getComputedStyle(node).position)).toBe("absolute");
            await page.keyboard.press("Escape");
            expect(await toggle.getAttribute("aria-expanded")).toBe("false");
          }
          const dimensions = await header.evaluate(node => ({
            header: node.getBoundingClientRect().height,
            page: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
          }));
          await header.screenshot({ path: resolve(output, `${path === "/" ? "home" : "teacher"}-${width}.png`) });
          expect(dimensions.page, `${path} at ${width}px`).toBe(dimensions.viewport);
          expect(dimensions.header, `${path} at ${width}px`).toBeLessThanOrEqual(80);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}, 60000);
