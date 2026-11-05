import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { DEMO_SAVE_KEY, newDemoV3State } from "../../apps/web/src/lib/demo/v3-session";

it.runIf(process.env.RUN_HISTORY_DEMO_BROWSER === "1")("rewards source reasoning, persists hints and presents a quieter discovery map", async () => {
  const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || "chrome"});
  const page = await browser.newPage({viewport:{width:1440,height:950},reducedMotion:"reduce"});
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const state = newDemoV3State(); state.intro = false; state.held = ["life"]; state.open = "life";
    await page.addInitScript(({key,state}) => { if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(state)); },{key:DEMO_SAVE_KEY,state});
    await page.goto("http://127.0.0.1:3012/demo/lim-bo-seng",{waitUntil:"networkidle"});
    const question = page.getByRole("region",{name:"Source question"});
    await question.waitFor();
    expect(await page.locator("[data-document-paragraph]").innerText()).not.toContain("SOURCE LIMITS");
    await question.getByRole("radio",{name:"Lim stayed in Singapore throughout the occupation"}).check();
    await question.getByRole("button",{name:"Check answer"}).click();
    await question.getByText(/Not quite/).waitFor();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).notes.length,DEMO_SAVE_KEY)).toBe(0);
    await question.getByRole("radio",{name:"Lim left before the fall, then returned to Malaya in 1943"}).check();
    await question.getByRole("button",{name:"Check answer"}).click();
    await question.getByText("✓ Evidence note saved to your journal.").waitFor();
    await mkdir("output/history-demo-check",{recursive:true});
    await page.screenshot({path:"output/history-demo-check/source-question.png"});
    await page.reload({waitUntil:"networkidle"});
    await question.getByText("✓ Hint unlocked").waitFor();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).notes.length,DEMO_SAVE_KEY)).toBe(1);
    await page.getByRole("button",{name:/Put down/}).click();
    await page.getByRole("button",{name:"Source archive",exact:true}).click();
    await question.getByText("✓ Hint unlocked").waitFor();
    await page.setViewportSize({width:390,height:844});
    await question.locator("legend").scrollIntoViewIfNeeded();
    await page.screenshot({path:"output/history-demo-check/source-question-mobile.png"});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Close source archive"}).click();
    await page.setViewportSize({width:1440,height:950});
    const chapter2 = newDemoV3State(1); chapter2.intro = false; chapter2.room = "shore";
    await page.evaluate(({key,state}) => localStorage.setItem(key,JSON.stringify(state)),{key:DEMO_SAVE_KEY,state:chapter2});
    await page.reload({waitUntil:"networkidle"});
    await page.locator("canvas").waitFor();
    await page.waitForTimeout(1500);
    await page.mouse.move(10,10);
    await page.screenshot({path:"output/history-demo-check/discovery-map.png"});
    // Wireless kit in the coordination shelter, verified against its rendered screenshot.
    await page.mouse.move(235, 435);
    expect(await page.locator("canvas").evaluate((canvas) => canvas.style.cursor)).toBe("pointer");
    await page.waitForTimeout(250);
    await page.screenshot({path:"output/history-demo-check/discovery-hover.png"});
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
},90000);
