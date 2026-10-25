import { it, expect } from "vitest";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import {
  newDemoV3State,
  DEMO_SAVE_KEY,
} from "../../apps/web/src/lib/demo/v3-session";

it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")(
  "walks through connected rooms, preserves progress and plays the optional rickshaw ride",
  async () => {
    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 950 },
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    const missing: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/demo/lim-bo-seng/") && r.status() >= 400)
        missing.push(r.url());
    });
    const room = async (id: string) =>
      page.waitForFunction(
        ({ key, id }) =>
          JSON.parse(localStorage.getItem(key) || "{}").room === id,
        { key: DEMO_SAVE_KEY, id },
      );
    const step = async (key: string, count = 1) => {
      await page.locator("canvas").focus();
      for (let i = 0; i < count; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(100);
      }
    };
    try {
      await mkdir("output/history-demo-check", { recursive: true });
      await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng", {
        waitUntil: "networkidle",
      });
      const state = { ...newDemoV3State(), room: "street", intro: false };
      await page.evaluate(
        ({ key, state }) => localStorage.setItem(key, JSON.stringify(state)),
        { key: DEMO_SAVE_KEY, state },
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("canvas").waitFor();
      await page.screenshot({
        path: "output/history-demo-check/connected-street.png",
      });
      // Physical walking through the provision-shop threshold; no entry confirmation.
      await step("ArrowUp", 3);
      await room("household");
      await page
        .getByRole("combobox", { name: "Walk to", exact: true })
        .waitFor({ state: "hidden" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: "output/history-demo-check/connected-shop.png",
      });
      for (let i = 0; i < 3; i++) {
        await step("ArrowUp");
        const down = page.getByRole("button", { name: /Put down/ });
        if (await down.isVisible()) await down.click();
      }
      const putDown = page.getByRole("button", { name: /Put down/ });
      if (await putDown.isVisible()) await putDown.click();
      await step("ArrowUp");
      await page
        .getByRole("button", { name: "Press E to talk to Lim Bo Seng" })
        .waitFor();
      await step("e");
      await page.getByLabel("Ask Lim Bo Seng a question").waitFor();
      await page
        .getByRole("button", { name: "Close conversation (Esc)" })
        .click();
      await page
        .getByRole("button", { name: "Walk outside", exact: true })
        .click();
      await room("street");
      await page
        .getByRole("combobox", { name: "Walk to", exact: true })
        .waitFor({ state: "hidden" });
      await page.waitForTimeout(200);
      // Click-to-walk reaches the home doorway and switches maps automatically.
      await page
        .getByRole("button", { name: "Walk to 住家 · Home", exact: true })
        .click();
      await room("quay");
      await page
        .getByRole("combobox", { name: "Walk to", exact: true })
        .waitFor({ state: "hidden" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: "output/history-demo-check/connected-home.png",
      });
      await page.getByText("Optional discoveries", { exact: true }).click();
      await page
        .getByRole("button", { name: /Arrange household support/ })
        .click();
      await page
        .getByRole("button", { name: /Household provisions Someone/ })
        .click();
      await page
        .getByRole("button", { name: /Care for the children A named/ })
        .click();
      await page
        .getByText("What remains unresolved?", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Return to exploring", exact: true })
        .click();
      await page.reload({ waitUntil: "networkidle" });
      await room("quay");
      await page
        .getByRole("combobox", { name: "Walk to", exact: true })
        .waitFor({ state: "hidden" });
      await step("ArrowRight");
      await step("ArrowDown", 2);
      await room("street");
      await page
        .getByRole("combobox", { name: "Walk to", exact: true })
        .waitFor({ state: "hidden" });
      await page.waitForTimeout(200);
      await page.getByText("Optional discoveries", { exact: true }).click();
      await page
        .getByRole("button", { name: "Ride the rickshaw", exact: true })
        .click();
      const ride = page.getByRole("dialog", {
        name: "A ride along River Street",
      });
      await ride.waitFor();
      await page
        .getByRole("button", { name: "Pause ride", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Next line", exact: true })
        .click();
      await page.evaluate(async () => {
        await Promise.all(
          ["river-provision-full.svg", "rickshaw-side.svg", "civilian.svg"].map(
            (file) => {
              const img = new Image();
              img.src = `/demo/lim-bo-seng/map/${file}`;
              return img.decode();
            },
          ),
        );
      });
      await page.screenshot({
        path: "output/history-demo-check/rickshaw-ride.png",
      });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      expect(
        await ride
          .locator('[aria-label^="Animated rickshaw"]')
          .evaluate((node) => node.getAnimations({ subtree: true }).length),
      ).toBeGreaterThan(0);
      expect(await ride.locator('[role="status"]').innerText()).toContain(
        "The shops are still here",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "output/history-demo-check/rickshaw-mobile.png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Step off the rickshaw", exact: true })
        .click();
      expect(
        await page.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key) || "{}").decisions.length,
          DEMO_SAVE_KEY,
        ),
      ).toBe(0);
      expect(errors).toEqual([]);
      expect(missing).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  90000,
);
