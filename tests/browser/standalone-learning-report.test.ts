import { it, expect } from "vitest";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  newDemoV3State,
  DEMO_SAVE_KEY,
} from "../../apps/web/src/lib/demo/v3-session";

it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")(
  "downloads a readable offline report and prints it as an A4 PDF",
  async () => {
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    try {
      const dir = resolve("output/history-demo-check");
      await mkdir(dir, { recursive: true });
      await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng", {
        waitUntil: "networkidle",
      });
      const state = newDemoV3State();
      state.phase = "reveal";
      state.intro = false;
      state.stage = 1;
      state.room = "shore";
      state.decisions = [
        { stage: 0, choice: "family", prediction: "", evidence: ["family"] },
        {
          stage: 1,
          choice: "corroborate",
          prediction: "",
          evidence: ["farewell-c"],
        },
      ];
      state.notes = [
        {
          id: "source-0-family",
          text: "Family commitments remained even when Lim left. The biography does not tell us every household arrangement.",
          source: "document",
          stageIndex: 0,
          at: 0,
        },
        {
          id: "source-1-farewell-c",
          text: "Tan’s retrospective account describes mixed feelings. A remembered mood cannot establish what every recruit felt.",
          source: "document",
          stageIndex: 1,
          at: 0,
        },
      ];
      state.answers = [
        {
          verdictId: "community",
          text: "Resistance depended on cooperation and practical support. Civilians could bear costs even when they were not fighters.",
          evidenceNoteIds: [state.notes[0].id],
        },
        {
          verdictId: "community",
          text: "The sources have different limits. A retrospective memory is not proof of everyone's feelings, and Singapore records do not establish what happened in a particular Perak household.",
          evidenceNoteIds: [state.notes[1].id],
        },
      ];
      state.messages.push({
        ...state.messages[0],
        id: "question",
        kind: "player",
        text: "Could a source prove <everyone> felt the same?",
        stageIndex: 1,
      });
      await page.evaluate(
        ({ key, state }) => localStorage.setItem(key, JSON.stringify(state)),
        { key: DEMO_SAVE_KEY, state },
      );
      await page.reload({ waitUntil: "networkidle" });
      const downloadPromise = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download learning report", exact: true })
        .click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(
        "lim-bo-seng-learning-report.html",
      );
      const file = resolve(dir, download.suggestedFilename());
      await download.saveAs(file);
      const html = await readFile(file, "utf8");
      expect(html).toContain("&lt;everyone&gt;");
      expect(html).not.toContain("<everyone>");
      const requests: string[] = [];
      const errors: string[] = [];
      const report = await browser.newPage({
        viewport: { width: 1280, height: 1000 },
      });
      report.on("request", (r) => {
        if (r.url().startsWith("http")) requests.push(r.url());
      });
      report.on("pageerror", (e) => errors.push(e.message));
      await report.goto(pathToFileURL(file).href);
      expect(
        await report
          .getByRole("heading", { name: "My final reflections", exact: true })
          .count(),
      ).toBe(1);
      expect(await report.locator("section.chapter").count()).toBe(2);
      expect(
        await report
          .getByText("Could a source prove <everyone> felt the same?", {
            exact: true,
          })
          .count(),
      ).toBe(1);
      await report.screenshot({
        path: resolve(dir, "learning-report-desktop.png"),
      });
      await report.setViewportSize({ width: 390, height: 844 });
      expect(
        await report.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await report.screenshot({
        path: resolve(dir, "learning-report-mobile.png"),
      });
      await report.pdf({
        path: resolve(dir, "learning-report-print.pdf"),
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;text-align:center;font-size:9px;color:#58645b">Learning report · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      await report.evaluate(() => {
        window.print = () => {
          document.body.dataset.printed = "yes";
        };
      });
      await report
        .getByRole("button", { name: "Print / Save as PDF", exact: true })
        .click();
      expect(await report.locator("body").getAttribute("data-printed")).toBe(
        "yes",
      );
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  60000,
);
