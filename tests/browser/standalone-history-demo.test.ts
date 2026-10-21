import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
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
      // The authored map's first paper is one tile west of the spawn.
      await page.keyboard.press("ArrowLeft");
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
  "renders all five authored settings, inspects props and walks to the harbour",
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
      // Native map click, using the inspected screenshot's tile coordinates (2x zoom).
      const bounds = (await page.locator("canvas").boundingBox())!;
      await page.mouse.click(bounds.x + 3.5 * 32, bounds.y + 9.5 * 32);
      await page.getByRole("dialog").waitFor();
      await page
        .getByText("Provisions and responsibility", { exact: false })
        .waitFor();
      await page
        .getByRole("button", { name: "Return to the map", exact: true })
        .click();
      await page.locator("canvas").focus();
      for (let i = 0; i < 6; i++)
        await page.keyboard.press("ArrowDown", { delay: 35 });
      for (let i = 0; i < 22; i++)
        await page.keyboard.press("ArrowRight", { delay: 35 });
      for (let i = 0; i < 7; i++)
        await page.keyboard.press("ArrowDown", { delay: 35 });
      await page.waitForFunction(
        () =>
          JSON.parse(
            localStorage.getItem("standalone.lim-bo-seng.v3.v1") || "{}",
          ).room === "quay",
      );
      await page.screenshot({
        path: "output/history-demo-check/authored-harbour.png",
      });
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
