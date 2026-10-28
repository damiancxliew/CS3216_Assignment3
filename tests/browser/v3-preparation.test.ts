import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";
import { EngineSpec, project } from "@adventure/engine";
import { findPath, type Point } from "@adventure/game-core";
import { Harness } from "../../packages/engine/tests/fixtures/harness";
import { mini } from "../../packages/engine/tests/fixtures/mini";

// Synthetic content, actual engine, character post-turn checks, player UI and map.
// Only model replies and the HTTP persistence transport are deterministic fixtures.
function preparationSpec() {
  const spec = structuredClone(mini);
  spec.title = "Preparation browser fixture";
  spec.role.position = "Synthetic browser test adventure";
  spec.stages[0]!.title = "The harbour supply inquiry";
  spec.stages[0]!.centralQuestion = "How should the remaining supplies be shared?";
  spec.characters[0]!.name = "Ada";
  spec.characters[1]!.name = "Ben";
  const letter = spec.documents[0]!;
  letter.real = false;
  letter.title = "The harbour letter";
  letter.body = "The boats reached the harbour before dawn. Only three sacks remained for the households. The clerk asked the council to share them carefully. Further supplies might arrive next week. The letter gives no count of households.";
  const passage = "Only three sacks remained for the households.";
  const support = { start: letter.body.indexOf(passage), end: letter.body.indexOf(passage) + passage.length };
  letter.keyPassages = [{ id: "kp1", ...support }];
  const otherPassage = "The letter gives no count of households.";
  const otherSupport = { start: letter.body.indexOf(otherPassage), end: letter.body.indexOf(otherPassage) + otherPassage.length };
  letter.keyPassages.push({ id: "kp2", ...otherSupport });
  spec.discoveries.push({ id: "d-letter-context", stageId: "s1", holder: { documentId: "letter", keyPassageId: "kp2" }, text: "The letter does not count households.", note: "The supply letter gives no household count.", core: false, sourceLabel: "Synthetic browser source" });
  const task = (id: string, prompt: string) => ({
    id, prompt,
    options: [{ id: "limited", text: "The council had a limited supply to divide." }, { id: "enough", text: "Every household was guaranteed a sack." }, { id: "empty", text: "The harbour had no supplies at all." }],
    correctOptionId: "limited", support: [support], explanation: "The three remaining sacks show a limited supply, without proving how much each household could receive.",
  });
  letter.readingCheck = { discoveryId: "d-letter", variants: [task("q1", "What can the letter support?"), task("q2", "What does the stock count tell the council?"), task("q3", "Which conclusion stays within the letter's evidence?"), task("q4", "Which account fits the supply report?")], recovery: task("correction", "What does the sentence about three sacks establish?"), recoveryDiscoveryIds: ["d-memo"] };
  const memo = spec.documents[1]!;
  memo.title = "The household register";
  memo.body = "The register was updated that morning. Nine households were recorded beside the river. Several boats were expected in the afternoon. The register does not list the size of each household.";
  const registerPassage = "Nine households were recorded beside the river.";
  const registerSupport = { start: memo.body.indexOf(registerPassage), end: memo.body.indexOf(registerPassage) + registerPassage.length };
  memo.keyPassages = [{ id: "kp-memo", ...registerSupport }];
  const registerTask = (id: string) => ({ id, prompt: "Which claim can the register support?", options: [{ id: "nine", text: "At least nine households needed consideration." }, { id: "same", text: "Every household was the same size." }, { id: "boats", text: "Nine boats carried supplies." }], correctOptionId: "nine", support: [registerSupport], explanation: "The register counts households, but it does not show their sizes." });
  memo.readingCheck = { discoveryId: "d-memo", variants: [registerTask("r1"), registerTask("r2"), registerTask("r3"), registerTask("r4")], recovery: registerTask("r-correction"), recoveryDiscoveryIds: ["d-letter"] };
  spec.discoveries.push({ id: "d-memo", stageId: "s1", holder: { documentId: "memo", keyPassageId: "kp-memo" }, text: "Nine households were registered.", note: "Nine households appear in the register.", core: true, sourceLabel: "Synthetic browser source" });
  spec.discoveries.find((discovery) => discovery.id === "d-letter")!.note = "Only three sacks remained at the harbour.";
  spec.stages[0]!.documentPlacement = { letter: "held", memo: "held" };
  spec.stages[0]!.preparation = {
    characters: { a: [{ discoveryIds: ["d-letter", "d-letter-context"], minMet: 2 }, { discoveryIds: ["d-memo", "d-m1"], minMet: 1 }], b: [{ discoveryIds: ["d-letter"], minMet: 1 }] },
    decision: [{ discoveryIds: ["d-letter", "d-memo"], minMet: 2 }, { discoveryIds: ["d-m1"], minMet: 1 }],
    essentialCharacters: [{ characterId: "a", discoveryIds: ["d-a1"] }, { characterId: "b", discoveryIds: ["d-b1"] }],
  };
  return { spec: EngineSpec.parse(spec), support, registerSupport };
}

it.runIf(process.env.RUN_PREPARATION_BROWSER_TESTS === "1").each([
  { name: "desktop", viewport: { width: 1280, height: 850 } },
  { name: "mobile", viewport: { width: 375, height: 667 } },
])("requires supported reading and essential conversations, with recoverable mistakes ($name)", async ({ name, viewport }) => {
  const fixture = preparationSpec();
  const game = new Harness(fixture.spec);
  game.now = Date.now();
  let revision = 0;
  const actions: string[] = [];
  const errors: string[] = [];
  const output = resolve("output/v3-preparation-check");
  await mkdir(output, { recursive: true });
  const root = resolve("apps/web");
  const stubs: Record<string, string> = {
    "next/image": "import React from 'react'; export default function Image({fill,unoptimized,...props}) {return React.createElement('img',props);}",
    "next/font/google": "export const Pixelify_Sans = () => ({className:''});",
    "next/link": "import React from 'react'; export default function Link(p){return React.createElement('a',p);}",
  };
  const vite = await createServer({
    configFile: false, root, publicDir: resolve(root, "public"), cacheDir: resolve(`node_modules/.vite/v3-preparation-${name}`),
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" }, optimizeDeps: { include: ["react", "react-dom/client", "phaser", "lucide-react", "@radix-ui/react-select", "next/navigation", "@supabase/ssr", "@supabase/supabase-js"] },
    css: { postcss: { plugins: [tailwind()] } }, resolve: { alias: { "@": resolve(root, "src") } },
    plugins: [{
      name: "preparation-browser-fixture", enforce: "pre",
      resolveId(id) { if (stubs[id]) return `\0stub:${id}`; if (id === "virtual:preparation") return "\0virtual:preparation"; },
      async load(id) {
        if (id.startsWith("\0stub:")) return stubs[id.slice(6)];
        if (id !== "\0virtual:preparation") return;
        return (await transformWithEsbuild(`
          import React from 'react'; import Phaser from 'phaser'; import {createRoot} from 'react-dom/client';
          import {V3PlayClient} from '/src/components/play/v3/v3-play-client.tsx'; import '/src/app/globals.css';
          const boot=Phaser.Game.prototype.boot; Phaser.Game.prototype.boot=function(){window.preparationGame=this;boot.call(this)};
          const initial=await fetch('/api/v3/attempts/preparation-${name}').then(r=>r.json());
          createRoot(document.getElementById('root')).render(<V3PlayClient attemptId="preparation-${name}" initialView={initial.view} initialRevision={initial.revision}/>);
        `, "preparation-browser.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) { server.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next();
        response.setHeader("Content-Type", "text/html");
        response.end('<html style="--font-ui:Arial;--font-record:Georgia"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:preparation"></script></body></html>');
      }); },
    }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let activePage: Page | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await vite.listen();
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport, reducedMotion: "reduce", hasTouch: name === "mobile" });
    activePage = page;
    page.setDefaultTimeout(15_000);
    await page.addInitScript(() => localStorage.setItem("play.muted", "1"));
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/v3/attempts/**", async (route) => {
      if (route.request().method() === "POST") {
        const { action } = route.request().postDataJSON();
        actions.push(action.type);
        if (action.type === "message") game.replyText = action.text === "Hello" ? "Good morning." : action.characterId === "a" ? "I want a share of the trade to support the households." : "My orders came from Calcutta.";
        try { await game.act(action); revision++; }
        catch (error) { await route.fulfill({ status: 400, json: { error: { code: "error", message: String(error) } } }); return; }
        if (action.type === "message" || action.type === "insertNote") {
          checkTimer = setTimeout(() => { void game.check({ conveyed: action.text === "Hello" ? [] : [action.characterId === "a" ? "d-a1" : "d-b1"], substantive: action.text !== "Hello" }).then(() => { revision++; }); }, 100);
        }
      }
      await route.fulfill({ json: { revision, view: project(game.spec, game.state) } });
    });
    await page.goto(vite.resolvedUrls!.local[0]!);
    await page.getByRole("button", { name: "Enter the first stage" }).click();
    await page.getByText("Before you decide", { exact: true }).waitFor();
    expect(game.state.stageEndsAt).toBeNull();
    await page.getByText("Speak with Ada.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Start exploring" }).click();
    await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
    expect(game.state.stageEndsAt).not.toBeNull();
    if (name === "mobile") {
      await page.getByRole("region", { name: "Mission" }).getByText(/Next:.*Read.*harbour letter/).waitFor();
      await page.getByRole("button", { name: "Show mission" }).click();
    }
    const mission = page.getByRole("region", { name: "Mission" });
    await mission.getByText(/Next:.*Read.*harbour letter/).waitFor();
    await mission.getByRole("list", { name: "Essential conversations" }).getByText("Speak with Ada").waitFor();
    await page.getByRole("button", { name: /Review stage decision \(\d+ steps left\)/ }).waitFor();
    await page.screenshot({ path: resolve(output, `${name}-mission-next-step.png`) });
    await page.getByRole("button", { name: "Review stage decision" }).click();
    const locked = page.getByRole("dialog", { name: "There is more to investigate" });
    await locked.getByText("Essential conversations: 0 of 2", { exact: false }).waitFor();
    expect(await locked.getByRole("progressbar", { name: "Essential conversations", exact: true }).getAttribute("aria-valuemax")).toBe("2");
    expect(await locked.getByRole("progressbar", { name: "Evidence preparation", exact: true }).getAttribute("aria-valuenow")).toBe("0");
    await locked.getByText(/Read.*harbour letter/).waitFor();
    await page.screenshot({ path: resolve(output, `${name}-locked-decision.png`) });
    await page.keyboard.press("Escape");
    expect(await page.getByRole("button", { name: "Review stage decision" }).evaluate(element => element === document.activeElement)).toBe(true);
    if (await page.getByRole("button", { name: "Hide mission" }).isVisible()) await page.getByRole("button", { name: "Hide mission" }).click();
    await walkToCharacter(page, "a");
    await page.getByRole("button", { name: /talk to Ada/ }).getByText(/Read.*harbour letter/).waitFor();
    await page.screenshot({ path: resolve(output, `${name}-nearby-lock-reason.png`) });
    await page.getByRole("button", { name: /talk to Ada/ }).click();
    const preparation = page.getByRole("dialog", { name: "Prepare to talk to Ada" });
    expect(await preparation.getByLabel("Scroll contents").count()).toBe(0);
    expect(await preparation.getByRole("button", { name: "Roll up scroll" }).count()).toBe(0);
    await preparation.getByRole("button", { name: "Close guidance", exact: true }).waitFor();
    await preparation.getByRole("progressbar", { name: "Preparation", exact: true }).waitFor();
    expect(await preparation.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(await preparation.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("3");
    await page.screenshot({ path: resolve(output, `${name}-character-preparation.png`) });
    expect(actions).not.toContain("message");
    await page.keyboard.press("Tab");
    expect(await preparation.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");

    await openScroll(page, "The harbour letter");
    let reader = page.getByRole("dialog", { name: "The harbour letter" });
    await reader.getByRole("radio", { name: "The council had a limited supply to divide." }).check();
    await highlight(page, 0, fixture.spec.documents[0]!.body.length);
    const selectionColors = await page.locator("[data-document-paragraph]").evaluate(element => {
      const style = getComputedStyle(element, "::selection");
      return { background: style.backgroundColor, color: style.color };
    });
    expect(selectionColors).toEqual({ background: "rgb(242, 210, 126)", color: "rgb(57, 37, 21)" });
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    expect(await page.locator("[data-document-paragraph]").evaluate(element => ({ background: getComputedStyle(element, "::selection").backgroundColor, color: getComputedStyle(element, "::selection").color }))).toEqual(selectionColors);
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    expect(await reader.getByText("Choose supporting sentences without dragging").count()).toBe(0);
    await reader.getByRole("button", { name: "Submit answer and evidence" }).click();
    await reader.getByRole("heading", { name: "Review the evidence before trying again" }).waitFor();
    expect(await reader.locator("input[type=radio]:checked").count()).toBe(0);
    expect(await reader.getByRole("button", { name: "Try again" }).isDisabled()).toBe(true);
    expect(game.state.discovered).not.toContain("d-letter");
    expect(await reader.getByRole("button", { name: "Submit answer and evidence" }).count()).toBe(0);
    await page.screenshot({ path: resolve(output, `${name}-needs-review.png`) });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
    await openScroll(page, "The harbour letter");
    reader = page.getByRole("dialog", { name: "The harbour letter" });
    await reader.getByRole("heading", { name: "Review the evidence before trying again" }).waitFor();
    await reader.getByRole("radio", { name: "The council had a limited supply to divide." }).check();
    await highlight(page, 0, fixture.spec.documents[0]!.body.length);
    await reader.getByRole("button", { name: "Try again" }).click();
    await reader.getByRole("heading", { name: "Review the answer", exact: true }).waitFor();
    expect(await reader.getByRole("radio").count()).toBe(0);
    expect(await reader.getByText("What does the stock count tell the council?", { exact: true }).count()).toBe(0);
    expect(game.state.discovered).not.toContain("d-letter");
    expect(game.state.readingChecks!.letter!.attempts.at(-1)).toMatchObject({ correct: false, recovery: true });
    const correctSupport = reader.locator("[data-correct-support]");
    expect(await correctSupport.textContent()).toBe("Only three sacks remained for the households.");
    const green = { background: "rgb(189, 232, 192)", color: "rgb(22, 60, 32)" };
    expect(await correctSupport.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(green);
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    expect(await correctSupport.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(green);
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    await expect.poll(() => reader.getByLabel("Review the answer", { exact: true }).evaluate(element => getComputedStyle(element).color)).toBe("rgb(57, 37, 21)");
    await page.screenshot({ path: resolve(output, `${name}-answer-review.png`) });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
    await openScroll(page, "The harbour letter");
    reader = page.getByRole("dialog", { name: "The harbour letter" });
    await reader.getByRole("heading", { name: "Review the answer", exact: true }).waitFor();
    expect(await reader.locator("[data-correct-support]").textContent()).toBe("Only three sacks remained for the households.");
    await reader.getByRole("button", { name: "Try another question", exact: true }).click();
    await reader.getByText("What does the stock count tell the council?", { exact: true }).waitFor();
    expect(await reader.locator("[data-correct-support]").count()).toBe(0);
    expect(await reader.locator("input[type=radio]:checked").count()).toBe(0);
    expect(await reader.getByRole("button", { name: "Submit answer and evidence" }).isDisabled()).toBe(true);
    expect(game.state.discovered).not.toContain("d-letter");
    // Several failures in a row must correct the current question, never the
    // document's old shared correction or a previous variant.
    for (const [index, prompt] of ["What does the stock count tell the council?", "Which conclusion stays within the letter's evidence?"] .entries()) {
      await reader.getByRole("radio", { name: "Every household was guaranteed a sack." }).check();
      await highlight(page, fixture.support.start, fixture.support.end);
      await reader.getByRole("button", { name: "Submit answer and evidence" }).click();
      await reader.getByRole("heading", { name: "Review the evidence before trying again" }).waitFor();
      expect(await reader.getByText(prompt, { exact: true }).count()).toBe(1);
      expect(await reader.getByText("What can the letter support?", { exact: true }).count()).toBe(0);
      expect(await reader.locator("input[type=radio]:checked").count()).toBe(0);
      if (index === 1) {
        await page.keyboard.press("Escape");
        await page.reload();
        await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
        await openScroll(page, "The harbour letter");
        reader = page.getByRole("dialog", { name: "The harbour letter" });
        await reader.getByText(prompt, { exact: true }).waitFor();
      }
      await reader.getByRole("radio", { name: "The council had a limited supply to divide." }).check();
      await highlight(page, fixture.support.start, fixture.support.end);
      await reader.getByRole("button", { name: "Try again" }).click();
      await reader.getByText("Answer the new question to finish this reading check.", { exact: true }).waitFor();
    }
    await reader.getByText("Which account fits the supply report?", { exact: true }).waitFor();
    await reader.getByRole("radio", { name: "The council had a limited supply to divide." }).check();
    await highlight(page, fixture.support.start + 2, fixture.support.end - 2);
    await reader.getByRole("button", { name: "Submit answer and evidence" }).click();
    await reader.getByLabel("Reading check complete", { exact: true }).waitFor();
    await page.getByRole("button", { name: "New note: Only three sacks remained at the harbour.. Open notes" }).waitFor();
    expect(game.state.discovered.filter(id => id === "d-letter")).toHaveLength(1);
    expect(game.state.readingChecks!.letter!.attempts.map(attempt => attempt.correct)).toEqual([false, false, false, true, false, true, true]);
    // Direct highlighting still saves additional notes after the reading check.
    await chooseSentence(page, "The letter gives no count of households.");
    await reader.getByText("Added to your notes.", { exact: true }).waitFor();
    expect(game.state.discovered).toContain("d-letter-context");
    await chooseSentence(page, "The letter gives no count of households.");
    await reader.getByText(/No new note added/).waitFor();
    expect(game.state.discovered.filter(id => id === "d-letter-context")).toHaveLength(1);
    // The server clock expires while a scroll owns focus. An ordinary source
    // interaction delivers the authoritative timer update through the real engine.
    game.advance(600_001);
    await highlight(page, fixture.support.start, fixture.support.end);
    await expect.poll(() => project(game.spec, game.state).stage?.preparation?.timerExpired).toBe(true);
    await page.getByText("Saving…", { exact: true }).waitFor({ state: "hidden" });
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect(await page.getByRole("dialog", { name: "Time for the final conversations" }).count()).toBe(0);
    expect(game.state.moment).toBeNull();
    await page.keyboard.press("Escape");
    const finalCall = page.getByRole("dialog", { name: "Time for the final conversations" });
    await finalCall.getByText("The investigation time has ended. You still need to hear from every essential person before deciding.").waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    await page.screenshot({ path: resolve(output, `${name}-final-conversations.png`) });
    await page.keyboard.press("Escape");
    await openScroll(page, "The household register");
    reader = page.getByRole("dialog", { name: "The household register" });
    await reader.getByRole("radio", { name: "At least nine households needed consideration." }).check();
    await chooseSentence(page, "Nine households were recorded beside the river.");
    await reader.getByRole("button", { name: "Submit answer and evidence" }).click();
    await reader.getByLabel("Reading check complete", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, `${name}-reading-complete.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await closeJournal(page);
    await walkToCharacter(page, "a");
    await page.getByRole("button", { name: /talk to Ada/ }).click();
    const input = page.getByRole("textbox");
    await input.fill("Hello");
    await input.press("Enter");
    await expect.poll(() => game.state.transcript.some(message => message.kind === "player" && message.text === "Hello")).toBe(true);
    await expect.poll(() => game.state.pendingChecks.length).toBe(0);
    expect(project(game.spec, game.state).stage?.preparation?.essentialConversations[0]?.complete).toBe(false);
    await input.fill("How does the supply shortage affect the share you need?");
    await input.press("Enter");
    await expect.poll(() => project(game.spec, game.state).stage?.preparation?.essentialConversations[0]?.complete).toBe(true);
    await page.getByRole("button", { name: "Close conversation (Esc)" }).click();
    if (await page.getByRole("button", { name: "Show mission" }).isVisible()) await page.getByRole("button", { name: "Show mission" }).click();
    await page.getByText("Essential conversations: 1 of 2", { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Review stage decision" }).click();
    await page.getByRole("dialog", { name: "There is more to investigate" }).getByText("Ben: conversation still needed").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Hide mission" }).click();
    await walkToCharacter(page, "b");
    await page.getByRole("button", { name: /talk to Ben/ }).click();
    await input.fill("What do your orders require for these households?");
    await input.press("Enter");
    await expect.poll(() => project(game.spec, game.state).stage?.preparation?.ready).toBe(true);
    expect(project(game.spec, game.state).stage?.preparation).toMatchObject({ completed: 2, required: 3, timerExpired: true });
    await page.getByText("Adding to your notes…", { exact: true }).waitFor({ state: "hidden", timeout: 10_000 });
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.screenshot({ path: resolve(output, `${name}-essential-conversation.png`) });
    await page.getByRole("button", { name: "Close conversation (Esc)" }).click();
    const ready = page.getByRole("dialog", { name: "You can make the stage decision" });
    await ready.waitFor({ timeout: 10_000 });
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect(game.state.moment).toBeNull();
    await ready.getByRole("button", { name: "Keep exploring" }).click();
    await page.reload();
    await page.locator('canvas[tabindex="0"]').waitFor({ timeout: 45_000 });
    expect(await page.getByRole("dialog").count()).toBe(0);
    if (name === "mobile") await page.getByRole("button", { name: "Show mission" }).click();
    await page.getByRole("button", { name: "Help with this stage" }).click();
    await page.getByRole("dialog", { name: "How to prepare for this stage" }).getByText("Essential conversations: 2 of 2", { exact: false }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("region", { name: "Mission" }).getByText("You can make the stage decision.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Review stage decision", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Finish exploring and decide?" });
    await confirm.getByText(fixture.spec.stages[0]!.centralQuestion).waitFor();
    await page.screenshot({ path: resolve(output, `${name}-decision-confirmation.png`) });
    const bounds = await confirm.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await confirm.getByRole("button", { name: "Continue to decision" }).click();
    await page.getByRole("region", { name: "A defining moment" }).waitFor();
    expect(game.state.moment?.status).toBe("choosing");
    expect(errors).toEqual([]);
    await writeFile(resolve(output, `${name}-results.json`), JSON.stringify({ actions, errors, readingAttempts: game.state.readingChecks, essential: game.state.essentialConversations }, null, 2));
  } catch (error) {
    if (activePage) {
      await activePage.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => {});
      console.error({ errors, body: (await activePage.locator("body").innerText()).slice(0, 6000), state: game.state.readingChecks, lastActions: actions.slice(-8) });
    }
    throw error;
  } finally { if (checkTimer) clearTimeout(checkTimer); await browser?.close(); await vite.close(); }
}, 180_000);

async function openScroll(page: Page, title: string) {
  const journal = page.getByRole("region", { name: "Journal", exact: true });
  const header = journal.locator('[aria-controls="stage-island-panel"]');
  if (await header.getAttribute("aria-expanded") !== "true") await header.click();
  await journal.getByRole("tab", { name: /Documents/ }).click();
  await journal.getByRole("button", { name: title, exact: false }).click();
  await page.getByRole("dialog", { name: title }).waitFor();
}
async function closeJournal(page: Page) {
  const header = page.getByRole("region", { name: "Journal", exact: true }).locator('[aria-controls="stage-island-panel"]');
  if (await header.getAttribute("aria-expanded") === "true") await header.click();
}
async function chooseSentence(page: Page, sentence: string) {
  const text = await page.locator("[data-document-paragraph]").textContent();
  const start = text!.indexOf(sentence);
  expect(start).toBeGreaterThanOrEqual(0);
  await highlight(page, start, start + sentence.length);
}
async function highlight(page: Page, start: number, end: number) {
  await page.locator("[data-document-paragraph]").evaluate((element, offsets) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, offsets.start);
    range.setEnd(element.firstChild!, offsets.end);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { start, end });
}
async function walkToCharacter(page: Page, characterId: string) {
  const snapshot = await page.evaluate(() => (window as any).preparationGame.scene.getScene("tiled-map").current);
  let target = snapshot.actors.find((actor: any) => actor.id === characterId)?.position;
  if (!target) {
    const roomId = characterId === "b" ? "r2" : "r1";
    const door = snapshot.map.doors.find((door: any) => door.roomId === roomId);
    await walkTo(page, door.inside);
    const updated = await page.evaluate(() => (window as any).preparationGame.scene.getScene("tiled-map").current);
    target = updated.actors.find((actor: any) => actor.id === characterId).position;
  }
  await walkTo(page, target, true);
}
async function walkTo(page: Page, target: Point, stopBefore = false) {
  const snapshot = await page.evaluate(() => (window as any).preparationGame.scene.getScene("tiled-map").current);
  const player = snapshot.actors.find((actor: any) => actor.id === "player").position;
  const path = findPath(snapshot.map, snapshot.doors, player, target);
  expect(path).not.toBeNull();
  const steps = path!.filter(point => point.x !== player.x || point.y !== player.y);
  if (stopBefore) steps.pop();
  let from = player;
  await page.locator("canvas").focus();
  for (const point of steps) {
    await page.keyboard.press(point.x > from.x ? "ArrowRight" : point.x < from.x ? "ArrowLeft" : point.y > from.y ? "ArrowDown" : "ArrowUp");
    await expect.poll(() => page.evaluate(() => (window as any).preparationGame.scene.getScene("tiled-map").current.actors.find((actor: any) => actor.id === "player").position)).toEqual(point);
    await page.getByText("Saving…", { exact: true }).waitFor({ state: "hidden" });
    await page.waitForTimeout(170);
    from = point;
  }
}
