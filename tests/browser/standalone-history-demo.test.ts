import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { findPath, type Point } from "@adventure/game-core";
import { demoScenery } from "../../apps/web/src/lib/demo/v3-session";
import { seatIn } from "../../apps/web/src/lib/play/v3/map";

async function walkWaterfront(page: Page, start: Point, destination: Point) {
  const scene = demoScenery[0].authored;
  const route = findPath(scene.map, scene.initialDoors, start, destination)!;
  expect(route).not.toBeNull();
  let previous = start;
  await page.locator("canvas").focus();
  for (const point of route) {
    if (point.x === previous.x && point.y === previous.y) continue;
    const key = point.x > previous.x ? "ArrowRight" : point.x < previous.x ? "ArrowLeft" : point.y > previous.y ? "ArrowDown" : "ArrowUp";
    await page.keyboard.press(key);
    // Allow room-entry actions to settle before sending the next physical step.
    await page.waitForTimeout(100);
    const putDown = page.getByRole("button", { name: /Put down/ });
    if (await putDown.isVisible()) { await putDown.click(); await page.locator("canvas").focus(); }
    previous = point;
  }
}

async function completeOpeningActivities(page: Page) {
  await page.getByRole("button", { name: /Arrange household support/ }).click();
  await page.getByRole("button", { name: /Household provisions Someone/ }).click();
  await page.getByRole("button", { name: /Care for the children A named/ }).click();
  await page.getByRole("button", { name: "Return to the waterfront", exact: true }).click();
  await page.getByRole("button", { name: /Check the dated record/ }).click();
  await page.getByRole("button", { name: "The surrender that followed his departure" }).click();
  await page.getByRole("button", { name: "Return to the waterfront", exact: true }).click();
}
import { expect, it } from "vitest";

// Real v3 shell, Phaser map, walking, dialogue, document reader and notes.
// Live chat is intercepted; the demo adapter/API have separate transport tests.
it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")(
  "keeps the original v3 map and supports the standalone lesson",
  async () => {
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 950 },
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mkdir("output/history-demo-check", { recursive: true });
    await page.route("**/api/demo/lim-bo-seng/chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "live",
          reply:
            "The family record reminds us that public duty carried a private cost. What support could you arrange?",
          sources: ["family"],
        }),
      }),
    );
    try {
      await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng", {
        waitUntil: "networkidle",
      });
      if (await page.getByRole("dialog", { name: "Adventure opening" }).count())
        await page.keyboard.press("Escape");
      await page.locator("canvas").waitFor();
      await page
        .getByRole("button", { name: "Press E to talk to Lim Bo Seng" })
        .waitFor();
      await page
        .getByRole("button", { name: "Role brief", exact: true })
        .click();
      const brief = page.getByRole("dialog", { name: "Role brief" });
      await brief.waitFor();
      expect(await brief.locator("img").count()).toBe(2);
      expect(
        await brief
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      ).toBe(true);
      await page.screenshot({
        path: "output/history-demo-check/role-brief-photos.png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "output/history-demo-check/role-brief-mobile.png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Close role brief" }).click();
      await page.setViewportSize({ width: 1440, height: 950 });
      await page
        .getByRole("button", { name: "Stage introduction", exact: true })
        .click();
      await page.getByRole("dialog", { name: "Stage introduction" }).waitFor();
      await page.screenshot({
        path: "output/history-demo-check/stage-introduction.png",
      });
      await page.getByRole("button", { name: "Back to the map" }).click();
      await page.screenshot({
        path: "output/history-demo-check/v3-restored.png",
      });
      await page.locator("canvas").focus();
      await page.keyboard.press("e");
      await page
        .getByLabel("Ask Lim Bo Seng a question")
        .fill("What does leaving cost the household?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page
        .getByText(/The family record reminds us/)
        .last()
        .waitFor();
      expect(
        await page
          .getByText(/The family record reminds us/)
          .last()
          .innerText(),
      ).not.toMatch(
        /live (?:AI reconstruction|construction by AI)|Sources:|Inspect records in Source archive/i,
      );
      await page
        .getByRole("button", { name: "Close conversation (Esc)" })
        .click();
      await page.locator("canvas").focus();
      // The compact waterfront's first paper is one tile south of the spawn.
      await page.keyboard.press("ArrowDown");
      const reader = page.getByRole("dialog");
      await reader.waitFor();
      await page.locator("[data-document-paragraph]").evaluate((node) => {
        const text = node.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 100);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page.getByRole("button", { name: /Put down/ }).click();
      await page.waitForFunction(
        () =>
          JSON.parse(
            localStorage.getItem("standalone.lim-bo-seng.v3.v1") || "{}",
          ).notes?.length === 1,
      );
      const ganSeat = seatIn(demoScenery[0].authored.map, "quay", 1)!;
      await walkWaterfront(page, { x: 6, y: 11 }, ganSeat);
      await page.keyboard.press("e");
      await page.getByLabel("Ask Gan Choo Neo a question").fill("What help would the household need?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText(/The family record reminds us/).last().waitFor();
      await page.getByRole("button", { name: "Close conversation (Esc)" }).click();
      // Walking to the exit before completing both activities must not board.
      await walkWaterfront(page, ganSeat, { x: 27, y: 18 });
      const locked = page.getByRole("dialog", { name: "Before you board" });
      await locked.waitFor();
      expect(await locked.getByText("Arrange household support", { exact: true }).isVisible()).toBe(true);
      expect(await page.getByRole("dialog", { name: "A departure leaves people behind" }).count()).toBe(0);
      await page.getByRole("button", { name: "Return to the waterfront", exact: true }).click();
      // The trigger fires when re-entering the steps, never from an unrelated click.
      await walkWaterfront(page, { x: 26, y: 18 }, { x: 26, y: 17 });
      await completeOpeningActivities(page);
      await page.getByRole("button", { name: /I'm ready to decide/ }).click();
      await page.screenshot({
        path: "output/history-demo-check/exploration-confirmation.png",
      });
      await page.getByRole("button", { name: "Continue to decision" }).click();
      await page.getByRole("listbox", { name: "Choose an action" }).waitFor();
      await page.getByRole("option").first().click();
      await page
        .getByRole("listbox", { name: "Choose a prediction" })
        .waitFor();
      await page.getByRole("option").first().click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      // Decisions unlock a playable exit instead of skipping immediately to stage two.
      await walkWaterfront(page, { x: 26, y: 17 }, { x: 26, y: 18 });
      await page
        .getByRole("dialog", { name: "A departure leaves people behind" })
        .waitFor();
      const animation = page.getByLabel(
        "Illustrated animation: Lim walks down the quay, boards a boat, and the boat leaves. Gan remains ashore.",
      );
      expect(
        await animation.evaluate(
          (node) => node.getAnimations({ subtree: true }).length,
        ),
      ).toBeGreaterThan(0);
      await page.screenshot({
        path: "output/history-demo-check/quay-departure.png",
      });
      await page.getByRole("button", { name: "Pause scene" }).click();
      await page.getByRole("status").filter({ hasText: "Before we go" }).waitFor();
      await page.getByRole("button", { name: "Resume scene" }).click();
      await page.getByRole("status").filter({ hasText: "Gan Choo Neo" }).waitFor();
      // Automatic advance; no continue/board button is clicked.
      await page.getByRole("dialog", { name: "Adventure opening" }).waitFor({ timeout: 25000 });
      // Original v3 cinematic introduces stage two; keyboard skip is supported.
      await page.keyboard.press("Escape");
      await page.getByText("Stage 2 of 5", { exact: false }).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      if (await page.getByRole("dialog", { name: "Adventure opening" }).count())
        await page.keyboard.press("Escape");
      await page.locator("canvas").waitFor();
      await page.getByText("Stage 2 of 5", { exact: false }).waitFor();
      await page.screenshot({
        path: "output/history-demo-check/v3-stage-2.png",
      });
      await page
        .getByRole("button", { name: "Source archive", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      expect(await page.getByRole("dialog").locator("img").count()).toBe(1);
      await page.getByRole("button", { name: "Close source archive" }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "output/history-demo-check/v3-mobile.png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  120000,
);

it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")(
  "renders all five authored settings and completes the waterfront activities",
  async () => {
    const { demoScenery, newDemoV3State, DEMO_SAVE_KEY } = await import(
      "../../apps/web/src/lib/demo/v3-session"
    );
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 950 },
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const missing: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/demo/lim-bo-seng/") && r.status() >= 400)
        missing.push(r.url());
    });
    try {
      await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng", {
        waitUntil: "networkidle",
      });
      if (await page.getByRole("dialog", { name: "Adventure opening" }).count())
        await page.keyboard.press("Escape");
      await page.locator("canvas").waitFor();
      await page
        .getByRole("button", { name: "Press E to talk to Lim Bo Seng" })
        .waitFor();
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
      await page.screenshot({
        path: "output/history-demo-check/household-activity.png",
      });
      await page
        .getByRole("button", { name: "Return to the waterfront", exact: true })
        .click();
      await page
        .getByRole("button", { name: /Check the dated record/ })
        .click();
      await page
        .getByRole("button", {
          name: "The exact boat and quay Lim used to leave",
        })
        .click();
      await page.getByText(/Look again at the date/).waitFor();
      await page
        .getByRole("button", {
          name: "The surrender that followed his departure",
        })
        .click();
      await page.getByText(/Yes. It establishes surrender context/).waitFor();
      await page.screenshot({
        path: "output/history-demo-check/dated-record-activity.png",
      });
      await page
        .getByRole("button", { name: "Return to the waterfront", exact: true })
        .click();
      await page.reload({ waitUntil: "networkidle" });
      expect(
        await page
          .getByRole("button", { name: /✓ Arrange household support/ })
          .count(),
      ).toBe(1);
      expect(
        await page
          .getByRole("button", { name: /✓ Check the dated record/ })
          .count(),
      ).toBe(1);
      await page.getByText("Explore historical images", { exact: true }).click();
      for (const label of ["Rickshaw photograph", "Newspaper board · 20 February 1942", "Occupation currency"]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        const record = page.getByRole("dialog");
        await record.waitFor();
        const picture = record.locator("img");
        await picture.evaluate((node: HTMLImageElement) => node.decode());
        expect(await picture.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(100);
        await record.getByRole("button", { name: "Enlarge image", exact: true }).click();
        expect(await picture.getAttribute("data-enlarged")).toBe("true");
        await record.getByRole("button", { name: "Fit image", exact: true }).click();
        await page.screenshot({ path: `output/history-demo-check/explore-${label.split(" ")[0].toLowerCase()}.png` });
        await page.getByRole("button", { name: "Return to the waterfront", exact: true }).click();
      }
      for (let stage = 0; stage < 5; stage++) {
        const state = {
          ...newDemoV3State(),
          stage,
          intro: false,
          room: demoScenery[stage].authored.map.rooms[0].id,
          messages: [],
        };
        await page.evaluate(
          ({ key, state }) => localStorage.setItem(key, JSON.stringify(state)),
          { key: DEMO_SAVE_KEY, state },
        );
        await page.reload({ waitUntil: "networkidle" });
        if (
          await page.getByRole("dialog", { name: "Adventure opening" }).count()
        )
          await page.keyboard.press("Escape");
        await page.locator("canvas").waitFor();
        await page.getByRole("button", { name: /Press E to talk/ }).waitFor();
        await page.screenshot({
          path: `output/history-demo-check/authored-stage-${stage + 1}.png`,
        });
      }
      const originalSave = await page.evaluate(
        (key) => localStorage.getItem(key),
        DEMO_SAVE_KEY,
      );
      await page.goto(
        "http://127.0.0.1:3012/demo/lim-bo-seng?preview=waterfront-v2",
        { waitUntil: "networkidle" },
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Restart standalone demo" })
        .click();
      await page
        .getByRole("button", { name: "Restart demo", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Press E to talk to Lim Bo Seng" })
        .waitFor();
      expect(
        await page.evaluate((key) => localStorage.getItem(key), DEMO_SAVE_KEY),
      ).toBe(originalSave);
      await page.screenshot({
        path: "output/history-demo-check/waterfront-preview.png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "output/history-demo-check/waterfront-mobile.png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(missing).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  120000,
);

it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")(
  "shows the correct archival avatar for each historical character",
  async () => {
    const { demoScenery, newDemoV3State, DEMO_SAVE_KEY } = await import(
      "../../apps/web/src/lib/demo/v3-session"
    );
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 950 },
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng", {
        waitUntil: "networkidle",
      });
      for (const [stage, roomIndex, id, name] of [
        [0, 0, "lim", "Lim Bo Seng"],
        [0, 1, "gan", "Gan Choo Neo"],
        [1, 0, "tham", "Tham Sien Yen"],
        [1, 1, "tan", "Tan Chong Tee"],
        [3, 0, "elizabeth", "Elizabeth Choy"],
      ] as const) {
        const state = {
          ...newDemoV3State(),
          stage,
          intro: false,
          room: demoScenery[stage].authored.map.rooms[roomIndex].id,
          messages: [],
        };
        await page.evaluate(
          ({ key, state }) => localStorage.setItem(key, JSON.stringify(state)),
          { key: DEMO_SAVE_KEY, state },
        );
        await page.reload({ waitUntil: "networkidle" });
        if (
          await page.getByRole("dialog", { name: "Adventure opening" }).count()
        )
          await page.keyboard.press("Escape");
        await page
          .getByRole("button", { name: `Press E to talk to ${name}` })
          .waitFor();
        await page.locator("canvas").focus();
        await page.keyboard.press("e");
        await page.getByLabel(`Ask ${name} a question`).waitFor();
        const avatar = page
          .locator(`img[src="/demo/lim-bo-seng/portraits/${id}.webp"]`)
          .last();
        await avatar.evaluate((img) => (img as HTMLImageElement).decode());
        expect(
          await avatar.evaluate(
            (img) =>
              (img as HTMLImageElement).complete &&
              (img as HTMLImageElement).naturalWidth > 0,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `output/history-demo-check/avatar-${id}.png`,
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  120000,
);
