import { resolve } from "node:path";

import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_JOURNAL_BROWSER_TESTS === "1")(
  "keeps the Journal reachable during decisions without submitting acts from its controls, and its shortcuts out of the player's way",
  async () => {
    const root = resolve("apps/web");
    const vite = await createServer({
      configFile: false, root, publicDir: false,
      cacheDir: resolve("node_modules/.vite/v3-journal"),
      server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
      esbuild: { jsx: "automatic" },
      define: { "process.env": "{}" },
      optimizeDeps: { include: ["react", "react-dom/client", "lucide-react"] },
      css: { postcss: { plugins: [tailwind()] } },
      resolve: { alias: { "@": resolve(root, "src") } },
      plugins: [{
        name: "journal-test-harness", enforce: "pre",
        resolveId(id) {
          if (id === "next/font/google") return "\0font-stub";
          if (id === "virtual:journal-test") return "\0virtual:journal-test";
        },
        async load(id) {
          if (id === "\0font-stub") return "export const Pixelify_Sans = () => ({className: ''});";
          if (id !== "\0virtual:journal-test") return;
          return (await transformWithEsbuild(`
            import React, {useState} from 'react';
            import {createRoot} from 'react-dom/client';
            import {StagePlayScreen} from '/src/components/play/v3/stage-play-screen.tsx';
            import '/src/app/globals.css';
            const view = {
              phase: 'stage', stage: {index: 0, count: 2, title: 'Harbour', centralQuestion: 'What now?'},
              rooms: [], currentRoomId: null, characters: [], speakers: [], notes: [],
              messages: [{id:'m1', kind:'narration', text:'The council gathers.', stageIndex:0}],
              documentsHere: [], timer: null, pendingCheck: false,
              documents: [{id:'letter', title:'Harbour letter', kind:'letter', body:'A record from the harbour.',
                provenance:{masthead:null,date:'1819',sender:'A clerk',recipient:null,place:null},
                real:false, sourceLabel:null, glossary:[], open:false}],
              definingMoment: {momentId:'moment', scene:'Decide the future of the harbour.', deciderId:'chief',
                status:'choosing', acts:[{id:'welcome',text:'Welcome the ships.'}], predictionOptions:[]}
            };
            const calm = new URLSearchParams(location.search).has('calm');
            function App() {
              const [pendingCheck, setPendingCheck] = useState(false);
              const [locked, setLocked] = useState(false);
              const [activity, setActivity] = useState({messages: view.messages, notes: [], documents: view.documents});
              window.setMissionActivity = setActivity;
              window.setJournalPending = setPendingCheck;
              window.setJournalLocked = setLocked;
              window.journalActions = [];
              return <main className="flex h-dvh flex-col"><StagePlayScreen
                view={{...view, ...activity, pendingCheck, ...(calm ? {definingMoment: null} : {})}} busy={false} attemptId="journal-browser"
                movementLocked={locked} onOpenRoleBrief={() => window.journalActions.push('roleBrief')}
                send={action => window.journalActions.push(action.type)} /></main>;
            }
            createRoot(document.getElementById('root')).render(<App />);
          `, "journal-test.tsx", { loader: "tsx", jsx: "automatic" })).code;
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.split("?")[0] !== "/") return next();
            response.setHeader("Content-Type", "text/html");
            response.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:journal-test"></script></body></html>');
          });
        },
      }],
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const errors: string[] = [];
    try {
      await vite.listen();
      browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
        const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
        page.setDefaultTimeout(5_000);
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(vite.resolvedUrls!.local[0]!);
        expect(errors).toEqual([]);
        const journal = page.getByRole("region", { name: "Journal", exact: true });
        const header = journal.locator("[aria-controls='stage-island-panel']");
        await header.waitFor();
        const collapsed = (await journal.boundingBox())!;
        const moment = (await page.getByRole("region", { name: "A defining moment" }).boundingBox())!;
        expect(moment.y + moment.height).toBeLessThanOrEqual(collapsed.y);
        expect(collapsed.x + collapsed.width).toBeLessThanOrEqual(viewport.width);
        await page.evaluate(() => (window as unknown as { setJournalPending(value: boolean): void }).setJournalPending(true));
        await journal.getByRole("status").waitFor();
        expect((await journal.boundingBox())!.height).toBe(collapsed.height);
        await header.click();
        await expect.poll(() => header.getAttribute("aria-expanded")).toBe("true");
        if (viewport.width >= 640) await expect.poll(async () => (await journal.boundingBox())!.width).toBeGreaterThan(collapsed.width * 1.5);
        const expanded = (await journal.boundingBox())!;
        expect(expanded.x + expanded.width).toBeLessThanOrEqual(viewport.width);
        await page.screenshot({ path: `/tmp/journal-expanded-${viewport.width}.png` });
        const documents = journal.getByRole("tab", { name: /Documents/ });
        await documents.focus();
        await page.keyboard.press("Enter");
        await journal.getByRole("button", { name: /Harbour letter/ }).click();
        const reader = page.getByRole("dialog");
        await reader.waitFor();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        await reader.waitFor({ state: "detached" });
        await journal.getByRole("tab", { name: /Log/ }).click();
        await journal.getByText("The council gathers.").waitFor();
        expect(await journal.getByRole("tab", { name: /Notes/ }).isDisabled()).toBe(true);
        await page.keyboard.press("Escape");
        expect(await header.getAttribute("aria-expanded")).toBe("false");
        expect(await page.evaluate(() => (window as unknown as { journalActions: string[] }).journalActions)).toEqual(["openDocument", "closeDocument"]);
        await page.getByRole("option", { name: /Welcome the ships/ }).focus();
        await page.keyboard.press("Enter");
        expect(await page.evaluate(() => (window as unknown as { journalActions: string[] }).journalActions.at(-1))).toBe("act");
        await page.close();
      }

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(5_000);
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${vite.resolvedUrls!.local[0]!}?calm`);
      const journal = page.getByRole("region", { name: "Journal", exact: true });
      const header = journal.locator("[aria-controls='stage-island-panel']");
      await header.waitFor();
      const mission = page.getByRole("region", { name: "Mission", exact: true });
      await page.evaluate(() => (window as unknown as {setMissionActivity(value: unknown): void}).setMissionActivity({
        messages: [{id: 'hint', kind: 'thought', text: 'Ask the clerk about the ships.', stageIndex: 0, at: 60_000}],
        notes: [], documents: [],
      }));
      await mission.getByText('Ask the clerk about the ships.').waitFor();
      await page.screenshot({ path: '/tmp/mission-hint-desktop.png' });
      await mission.getByRole('button', {name: 'Open in Journal'}).click();
      await journal.getByRole('tab', {name: /Log/}).waitFor();
      await journal.getByText('Ask the clerk about the ships.').waitFor();
      await page.keyboard.press('Escape');
      await page.evaluate(() => (window as unknown as {setMissionActivity(value: unknown): void}).setMissionActivity({
        messages: [{id: 'hint', kind: 'thought', text: 'Ask the clerk about the ships.', stageIndex: 0, at: 60_000}],
        notes: [{id: 'note', text: 'The ships need permission.', source: 'conversation', stageIndex: 0, at: 120_000}],
        documents: [{id:'letter', title:'Harbour letter', kind:'letter', body:'A record from the harbour.',
          provenance:{masthead:null,date:'1819',sender:'A clerk',recipient:null,place:null},
          real:false, sourceLabel:null, glossary:[], open:false}],
      }));
      await mission.getByText('The ships need permission.').waitFor();
      expect(await mission.getByText('Ask the clerk about the ships.').count()).toBe(0);
      await mission.getByRole('button', {name: 'Open in Journal'}).click();
      await journal.getByText('The ships need permission.').waitFor();
      await page.keyboard.press('Escape');
      await mission.getByRole('button', {name: 'Hide mission'}).click();
      await page.evaluate(() => (window as unknown as {setMissionActivity(value: unknown): void}).setMissionActivity({
        messages: [{id: 'hint', kind: 'thought', text: 'Ask the clerk about the ships.', stageIndex: 0, at: 60_000}],
        notes: [{id: 'note', text: 'The ships need permission.', source: 'conversation', stageIndex: 0, at: 120_000}],
        documents: [{id:'letter', title:'Harbour letter', kind:'letter', body:'A record from the harbour.',
          provenance:{masthead:null,date:'1819',sender:'A clerk',recipient:null,place:null},
          real:false, sourceLabel:null, glossary:[], open:false},
          {id:'register', title:'Ships register', kind:'report', body:'Three ships await permission.',
          provenance:{masthead:null,date:null,sender:null,recipient:null,place:null},
          real:false, sourceLabel:null, glossary:[], open:false}],
      }));
      await mission.getByText('Ships register').waitFor();
      expect(await mission.getByRole('button', {name: 'Read document'}).count()).toBe(0);
      await mission.getByRole('button', {name: 'Show mission'}).click();
      await mission.getByText('Ships register').waitFor();
      await page.screenshot({ path: '/tmp/mission-focus-desktop.png' });
      await mission.getByRole('button', {name: 'Read document'}).click();
      await page.getByRole('dialog').getByText('Three ships await permission.').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({state: 'detached'});
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const focusInJournal = () => journal.evaluate((element) => element.contains(document.activeElement));
      await page.keyboard.press("2");
      expect(await header.getAttribute("aria-expanded")).toBe("true");
      expect(await journal.getByRole("tab", { name: /Documents/ }).getAttribute("aria-selected")).toBe("true");
      expect(await focusInJournal()).toBe(false);
      await page.keyboard.press("Escape");
      expect(await header.getAttribute("aria-expanded")).toBe("false");
      expect(await focusInJournal()).toBe(false);
      await header.click();
      await expect.poll(() => journal.getByRole("tab", { name: /Documents/ }).evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(() => header.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.evaluate(() => {
        (window as unknown as { setJournalLocked(value: boolean): void }).setJournalLocked(true);
        return new Promise((done) => requestAnimationFrame(() => setTimeout(done)));
      });
      for (const key of ["j", "1", "3", "r"]) await page.keyboard.press(key);
      expect(await header.getAttribute("aria-expanded")).toBe("false");
      expect(await page.evaluate(() => (window as unknown as { journalActions: string[] }).journalActions)).toEqual([]);
      await page.close();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
);
