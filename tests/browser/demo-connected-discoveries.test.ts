import { chromium } from "playwright";
import { expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import { DEMO_SAVE_KEY, newDemoV3State, projectDemoV3 } from "../../apps/web/src/lib/demo/v3-session";

it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")("opens shelf excerpts by walking and connects all three resistance rooms", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), DEMO_SAVE_KEY);
  const waitRoom = (room: string) => page.waitForFunction(({ key, room }) => JSON.parse(localStorage.getItem(key) || "{}").room === room, { key: DEMO_SAVE_KEY, room });
  try {
    await mkdir("output/history-demo-check", { recursive: true });
    const state = { ...newDemoV3State(), room: "records", intro: false };
    await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key: DEMO_SAVE_KEY, state });
    await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng", { waitUntil: "domcontentloaded" });
    await page.locator("canvas").waitFor();
    await page.getByRole("combobox", { name: "Walk to", exact: true }).waitFor({ state: "hidden" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: "output/history-demo-check/archive-shelves.png" });
    // Walk to the food folder: from (12,12), go left to x10, then up to its shelf approach at y5.
    await page.locator("canvas").focus();
    for (const key of ["ArrowLeft", "ArrowLeft", ...Array(7).fill("ArrowUp")]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(180);
    }
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || "{}").open === "food", DEMO_SAVE_KEY);
    await page.getByRole("region", { name: "Source question" }).waitFor();
    await page.getByRole("button", { name: /Put down/ }).click();
    await page.waitForTimeout(500);
    expect((await read()).open).toBeNull(); // Closing at the shelf must not immediately reopen it.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await read()).held).toContain("food");
    await page.locator("canvas").waitFor();
    await page.getByRole("combobox", { name: "Walk to", exact: true }).waitFor({ state: "hidden" });
    await page.waitForTimeout(700);
    // Clicking a highlighted folder walks to its shelf and opens it, too.
    await page.mouse.move(235, 180);
    await page.waitForFunction(() => document.querySelector("canvas")?.style.cursor === "pointer");
    await page.mouse.click(235, 180);
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || "{}").open === "choy", DEMO_SAVE_KEY);
    await page.getByRole("region", { name: "Source question" }).waitFor();
    await page.getByRole("button", { name: /Put down/ }).click();
    const chapter2 = { ...newDemoV3State(1), intro: false };
    await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: DEMO_SAVE_KEY, state: chapter2 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("canvas").waitFor();
    await page.getByRole("combobox", { name: "Walk to", exact: true }).waitFor({ state: "hidden" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: "output/history-demo-check/resistance-coast.png" });
    for (const [room, name, person] of [["shore", "Lim’s coordination shelter", "Lim Bo Seng"], ["liaison", "Tan’s map room", "Tan Chong Tee"], ["records", "Tham’s testimony room", "Tham Sien Yen"]]) {
      await page.getByRole("button", { name: `Walk to ${name}`, exact: true }).click();
      await waitRoom(room);
      await page.getByRole("button", { name: "Walk outside", exact: true }).waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `output/history-demo-check/resistance-${room}.png` });
      expect(projectDemoV3(await read()).characters.map((c) => c.name)).toEqual([person]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitRoom(room);
      await page.locator("canvas").waitFor();
      await page.getByRole("combobox", { name: "Walk to", exact: true }).waitFor({ state: "hidden" });
      await page.waitForTimeout(350);
      await page.getByRole("button", { name: "Walk outside", exact: true }).click();
      await waitRoom("coast");
      await page.waitForTimeout(400);
    }
    expect((await read()).decisions).toEqual([]);
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: "/tmp/connected-discovery-failure.png" });
    console.log("Room/read state", (await read()).room, (await read()).open);
    throw error;
  } finally { await browser.close(); }
}, 90000);
