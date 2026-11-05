import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

// Render the real workspace, chat, queue, preview and UI/CSS. Replace server and
// Next routing boundaries only; no database, uploads or model requests leave here.
it.runIf(process.env.RUN_CREATION_BROWSER_TESTS === "1")(
  "refines the desktop creation flow while preserving uploads and source previews",
  async () => {
    const root = resolve("apps/web");
    const output = resolve("output/v3-creation-check");
    await mkdir(output, { recursive: true });
    let fontCss = "";
    try {
      for (const filename of await readdir(resolve(root, ".next/static/css"))) {
        const css = await readFile(resolve(root, ".next/static/css", filename), "utf8");
        const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
        fontCss += faces.filter((face) => /Atkinson Hyperlegible Next|Literata/.test(face)).join("\n");
      }
      fontCss = fontCss.replaceAll("/_next/static/", `/@fs${resolve(root, ".next/static")}/`);
    } catch { /* A clean checkout uses the same production font fallbacks. */ }
    const initial = {
      adventureId: "00000000-0000-4000-8000-000000000001",
      draft: {}, sources: [],
      messages: [{ role: "assistant", text: "Let’s start with the material your students will play from. Upload a PDF or text file, or paste a passage.", slot: "sources" }],
    };
    const ready = {
      ...initial,
      draft: { sources: { summary: "Military and civilian accounts of Singapore in 1942.", episodeProposal: "The fall of Singapore" }, episode: "The fall of Singapore", focus: "Compare civilian experiences with official accounts.", readingLevel: "sec", timerMinutes: 45, mode: "standard" },
      sources: [{ id: "singapore", title: "Singapore, February 1942.pdf", kind: "pdf" }, { id: "civilian", title: "Civilian accounts.md", kind: "text" }],
      messages: [{ role: "assistant", text: "Here’s the brief. Create the adventure, or change anything first.", slot: "confirm" }],
    };
    const progress = { status: "generating", mode: "standard", costUsd: 0, steps: [
      { name: "sources", status: "succeeded", startedAt: new Date(Date.now() - 120000).toISOString(), finishedAt: new Date(Date.now() - 90000).toISOString() },
      { name: "skeleton", status: "succeeded", startedAt: new Date(Date.now() - 90000).toISOString(), finishedAt: new Date(Date.now() - 70000).toISOString() },
      { name: "details", status: "running", startedAt: new Date(Date.now() - 67000).toISOString() },
    ] };
    const actions = `
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      export async function addV3BriefSource(id, form) {
        const fixture = window.__creation;
        const file = form.get('file');
        const name = file?.name || 'Pasted passage';
        const token = form.get('uploadId');
        fixture.calls.push({name,token});
        fixture.inFlight++; fixture.maxInFlight = Math.max(fixture.maxInFlight, fixture.inFlight);
        await delay(fixture.uploadDelay ?? 180);
        fixture.inFlight--;
        if (name === 'retry.md' && !fixture.didFail) { fixture.didFail = true; throw Error('Simulated network interruption'); }
        if (!fixture.state.sources.some(source => source.id === token)) {
          fixture.state = {...fixture.state, sources:[...fixture.state.sources,{id:token,title:name,kind:name.endsWith('.pdf')?'pdf':'text'}]};
        }
        return {ok:true,state:structuredClone(fixture.state)};
      }
      export async function createFromV3Brief() { return {}; }
      export async function removeV3BriefSource(id, sourceId) {
        const fixture = window.__creation;
        fixture.state = {...fixture.state, sources: fixture.state.sources.filter(source => source.id !== sourceId)};
        return {ok:true,state:structuredClone(fixture.state)};
      }
      export async function discardV3Brief() { return {}; }
      export async function getV3GenerationProgress() { return window.__creation.progress ?? ${JSON.stringify(progress)}; }
    `;
    const vite = await createServer({
      configFile: false, cacheDir: resolve("node_modules/.vite/v3-creation"), root, publicDir: false,
      server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
      esbuild: { jsx: "automatic" },
      optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "@radix-ui/react-select", "zod", "@supabase/ssr", "@supabase/supabase-js"] },
      css: { postcss: { plugins: [tailwind()] } },
      define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": "undefined" },
      resolve: { alias: { "@": resolve(root, "src") }, dedupe: ["react", "react-dom"] },
      plugins: [{
        name: "creation-acceptance-harness", enforce: "pre",
        resolveId(id, importer) {
          if (id === "virtual:creation-test") return "\0virtual:creation-test";
          if (id === "next/navigation") return "\0next-navigation";
          if (id === "next/link") return "\0next-link";
          const absolute = id.startsWith(".") && importer ? resolve(dirname(importer), id) : id;
          if (absolute.endsWith("/v3/teacher/actions")) return "\0creation-actions";
          if (absolute.endsWith("/source-preview-actions")) return "\0preview-action";
          if (absolute.endsWith("/chat-actions")) return "\0chat-action";
        },
        async load(id) {
          if (id === "\0next-navigation") return "const router={refresh(){window.__creation.refreshes=(window.__creation.refreshes??0)+1},push(){}}; export function useRouter(){return router}; export function usePathname(){return '/v3/teacher/fixture'};";
          if (id === "\0next-link") return "import React from 'react'; export default function Link({children,...props}){return React.createElement('a',props,children)}";
          if (id === "\0creation-actions") return actions;
          if (id === "\0chat-action") return "export async function suggestReviewChangeAction(){return {ok:false,message:'No review target in fixture'}}";
          if (id === "\0preview-action") return `
            export async function previewBriefSource(id,sourceId) {
              await new Promise(resolve=>setTimeout(resolve,80));
              if(window.__creation.failPreview) {window.__creation.failPreview=false;return {ok:false,error:'Couldn’t load this source. Please try again.'};}
              const source=window.__creation.state.sources.find(source=>source.id===sourceId);
              return {ok:true,source:{title:source.title,kind:source.kind,pages:source.kind==='pdf'?[{page:3,text:'Stored extract from page three.'},{page:7,text:'Stored extract from page seven.'}]:[{page:1,text:'First paragraph of the civilian account.'},{page:2,text:'Second paragraph of the same continuous text source.'}]}};
            }
          `;
          if (id === "\0virtual:creation-test") return (await transformWithEsbuild(`
            import React from 'react'; import {createRoot} from 'react-dom/client';
            import {CreationWorkspace} from '/src/app/v3/teacher/[id]/creation-workspace.tsx';
            import {GenerationProgress, GenerationProgressCard} from '/src/app/v3/teacher/[id]/generation-progress.tsx';
            import {SourceMaterial} from '/src/app/v3/teacher/[id]/brief-sources.tsx';
            import {ReviewToolbar, GenerationToolbar} from '/src/app/v3/teacher/[id]/review-toolbar.tsx';
            import {Undo2, Sparkles} from 'lucide-react';
            import {reviewDiscard, reviewResolve, reviewPrimary} from '/src/app/v3/teacher/[id]/creation-styles.ts';
            import {SiteHeader} from '/src/components/ui.tsx';
            import {ConfirmButton} from '/src/app/v3/teacher/[id]/confirm-button.tsx';
            import {DraftLinks} from '/src/app/v3/teacher/[id]/draft-links.tsx';
            import '/src/app/globals.css';
            const mode=new URLSearchParams(location.search).get('state')||'empty';
            const initial=${JSON.stringify(initial)}; const ready=${JSON.stringify(ready)};
            const state=mode==='empty'?initial:mode==='cap'?{...initial,sources:Array.from({length:19},(_,index)=>({id:'existing-'+index,title:'Existing source '+(index+1)+'.txt',kind:'text'}))}:ready;
            window.__creation={state,calls:[],inFlight:0,maxInFlight:0,didFail:false,failPreview:false};
            function ScrollScenario() {
              const [passes, setPasses] = React.useState(1);
              const [extra, setExtra] = React.useState(0);
              return <>
                <button type="button" onClick={()=>setExtra(count=>count+20)}>Expand last pass</button>
                {Array.from({length:passes},(_,pass)=><section key={pass} data-generation-section={'pass-'+pass} data-generation-current={pass===passes-1?'ready':undefined}><h2>Generated pass {pass+1}</h2>{Array.from({length:60+(pass===passes-1?extra:0)},(_,index)=><p key={index}>Stage {index+1}: Students examine the source material and compare the different perspectives before making their decision.</p>)}</section>)}
                <ReviewToolbar primary={<button onClick={()=>setPasses(count=>count+1)}>Next simulated pass</button>}/>
              </>;
            }
            createRoot(document.getElementById('root')).render(
              <div className="min-h-screen md:flex md:h-dvh md:flex-col md:overflow-hidden">
                <SiteHeader/><main className="md:min-h-0 md:flex-1">
                  <CreationWorkspace brief={state} active={mode!=='generating'&&mode!=='scroll'&&mode!=='review'&&mode!=='draft'} generationProgress={mode==='generating'?<GenerationProgress adventureId={state.adventureId} seesCost={false}/>:mode==='review'||mode==='draft'?<GenerationProgressCard progress={{...${JSON.stringify(progress)},status:'needs_review',pausedAt:'details',steps:[...${JSON.stringify(progress)}.steps.slice(0,2),{...${JSON.stringify(progress)}.steps[2],status:'succeeded'}]}} seesCost={false} now={Date.now()}/>:null} generating={mode==='generating'} statusMessage={mode==='generating'?'Working on the next step…':''}>
                    {mode==='scroll'?<ScrollScenario/>:<>{mode==='draft'?<ReviewToolbar discard={<button className={reviewDiscard} aria-label="Discard changes" title="Discard changes" disabled><Undo2 aria-hidden size={16}/></button>} primary={<button className={reviewPrimary} aria-label="Save changes" disabled>Save</button>} secondary={<DraftLinks adventureId={state.adventureId}/>} resolve={<button className={reviewResolve} data-review-resolve disabled><Sparkles aria-hidden size={16}/>Resolve issues</button>}/>:mode==='generating'?<GenerationToolbar/>:mode==='review'?<ReviewToolbar discard={<ConfirmButton label={<Undo2 aria-hidden size={16}/>} ariaLabel="Discard" className={reviewDiscard} title="Discard your edits?" body="This restores the generated content for this step and removes your changes, so you can start this review again from the generated version." confirmLabel="Discard edits" onConfirm={()=>{}}/>} primary={<button className={reviewPrimary}>Continue</button>} summary={<span role="status" className="text-sm text-muted">Saving…</span>} resolve={<button className={reviewResolve} data-review-resolve><Sparkles aria-hidden size={16}/>Resolve issues</button>}/>:null}<SourceMaterial adventureId={state.adventureId} sources={state.sources}/></>}
                  </CreationWorkspace>
                </main>
              </div>
            );
          `, "creation-test.tsx", { loader: "tsx", jsx: "automatic" })).code;
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!request.url?.startsWith("/?") && request.url !== "/") return next();
            response.setHeader("Content-Type", "text/html");
            const theme = new URL(request.url!, "http://localhost").searchParams.get("theme") === "dark" ? "dark" : "light";
            response.end(`<html data-theme="${theme}" style="--font-ui:'Atkinson Hyperlegible Next',Arial;--font-record:Literata,Georgia"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fontCss}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:creation-test"></script></body></html>`);
          });
        },
      }],
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const errors: string[] = [];
    const measurements: unknown[] = [];
    try {
      await vite.listen();
      browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`); });
      await page.route("**/api/v3/brief/turn", async (route) => {
        const input = route.request().postDataJSON().input;
        const state = await page.evaluate((answer) => {
          const fixture = (window as unknown as { __creation: { state: { draft: { timerMinutes?: number }; messages: { role: string; text: string; slot: string }[] } } }).__creation;
          const next = structuredClone(fixture.state);
          if (answer.change === "timer") {
            delete next.draft.timerMinutes;
            next.messages.push({ role: "assistant", text: "How long should the adventure run?", slot: "timer" });
          } else {
            next.draft.timerMinutes = Number(answer.text);
            next.messages.push({ role: "assistant", text: "The timer is updated. Create the adventure, or change anything first.", slot: "confirm" });
          }
          fixture.state = next;
          return next;
        }, input);
        await route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "reply", index: 0, text: state.messages.at(-1)!.text })}\n${JSON.stringify({ type: "result", result: { ok: true, state } })}\n` });
      });
      const url = vite.resolvedUrls!.local[0]!;
      const visit = async (mode: string, theme = "light") => {
        await page.goto(`${url}?state=${mode}&theme=${theme}`);
        await page.locator("[data-creation-workspace]").waitFor({ timeout: 10_000 }).catch(async (error) => {
          await writeFile(resolve(output, "browser-errors.json"), JSON.stringify(errors, null, 2));
          throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}`);
        });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      };

      // Discard remains available throughout briefing, including confirmation and pencil edits.
      await visit("ready");
      expect(await page.locator('[data-creation-workspace] > header').getByRole("button", { name: "Discard brief", exact: true }).count()).toBe(1);
      expect(await page.locator('[aria-label="Adventure conversation"] footer').getByRole("button", { name: "Discard brief", exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "Discard brief", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Change timer", exact: true }).click();
      await page.getByRole("button", { name: "Discard brief", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      // Starting generation has one horizontal loading label and keeps the button's footprint.
      await visit("ready");
      const create = page.getByRole("button", { name: "Create adventure", exact: true });
      const beforeCreate = await create.boundingBox();
      await create.click();
      const creating = page.getByRole("button", { name: "Creating…", exact: true });
      await creating.waitFor();
      expect(await creating.isDisabled()).toBe(true);
      expect(await page.locator('[data-review-dock] [data-toolbar-progress]').count()).toBe(0);
      expect(await page.locator('[data-review-dock]').textContent()).not.toContain("Preparing");
      const duringCreate = await creating.boundingBox();
      expect(duringCreate!.height).toBe(beforeCreate!.height);
      expect(duringCreate!.width).toBe(beforeCreate!.width);
      await page.screenshot({ path: resolve(output, "starting-generation.png"), fullPage: true });

      // A completed pass must refresh server-rendered content even while generation continues.
      await page.clock.install();
      for (const mode of ["quick", "standard"]) {
        await visit("generating");
        await page.evaluate((mode) => {
          const fixture = (window as unknown as { __creation: { progress?: unknown; refreshes?: number } }).__creation;
          fixture.refreshes = 0;
          fixture.progress = { status: "generating", mode, costUsd: 0, warnings: [], steps: [
            { name: "sources", status: "succeeded" }, { name: "skeleton", status: "succeeded" },
            { name: "details", status: "succeeded" }, { name: "endings", status: "running" },
          ] };
        }, mode);
        await page.clock.runFor(4000);
        await expect.poll(() => page.evaluate(() => (window as unknown as { __creation: { progress?: unknown; refreshes?: number } }).__creation.refreshes ?? 0)).toBe(1);
        await page.clock.runFor(8000);
        expect(await page.evaluate(() => (window as unknown as { __creation: { progress?: unknown; refreshes?: number } }).__creation.refreshes)).toBe(1);
      }
      await page.clock.resume();

      await page.setViewportSize({ width: 1280, height: 800 });
      await visit("scroll");
      const content = page.locator("[data-generated-content]");
      // How far the current step's top sits below the top of the pane.
      const currentOffset = () => content.evaluate(node => node.querySelector("[data-generation-current]")!.getBoundingClientRect().top - node.getBoundingClientRect().top);
      expect(await content.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await page.getByRole("button", { name: "Next simulated pass", exact: true }).click();
      // Each newly generated step opens at its top, so all of it can be reviewed.
      await expect.poll(currentOffset).toBeLessThanOrEqual(1);
      expect(await currentOffset()).toBeGreaterThanOrEqual(-1);
      expect(await content.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Next simulated pass", exact: true }).click();
      await expect.poll(currentOffset).toBeLessThanOrEqual(1);
      // With motion allowed, the pane glides to the new step instead of jumping.
      {
        const motion = await browser.newPage({ reducedMotion: "no-preference", viewport: { width: 1280, height: 800 } });
        await motion.goto(`${url}?state=scroll`);
        const pane = motion.locator("[data-generated-content]");
        await pane.waitFor();
        await motion.getByRole("button", { name: "Next simulated pass", exact: true }).click();
        const samples: number[] = [];
        for (let i = 0; i < 20; i++) { samples.push(await pane.evaluate(node => node.scrollTop)); await motion.waitForTimeout(25); }
        const final = await pane.evaluate(node => node.querySelector("[data-generation-current]")!.getBoundingClientRect().top - node.getBoundingClientRect().top);
        expect(Math.abs(final)).toBeLessThanOrEqual(1);
        expect(samples.some(top => top > 0 && top < samples[samples.length - 1] - 1)).toBe(true);
        await motion.close();
      }
      // Expanding or editing never moves the pane, wherever the teacher is reading.
      for (const top of [0, 999_999]) {
        await content.evaluate((node, value) => { node.scrollTop = value; }, top);
        await page.waitForTimeout(50);
        const before = await content.evaluate(node => node.scrollTop);
        await page.getByRole("button", { name: "Expand last pass", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
        await page.waitForTimeout(150);
        expect(await content.evaluate(node => node.scrollTop)).toBe(before);
      }
      // Each toolbar mounts straight into the dock, never inline in the content.
      expect(await page.locator("[data-generated-content] [data-review-toolbar]").count()).toBe(0);
      expect(await page.getByRole("group", { name: "Review actions" }).evaluate(node => parseFloat(getComputedStyle(node).borderRadius))).toBeGreaterThanOrEqual(16);

      for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport);
        for (const theme of ["light", "dark"]) {
          let generatingControls: unknown;
          for (const mode of ["empty", "ready", "generating", "review"]) {
            await visit(mode, theme);
            expect(await page.getByRole("button", { name: "Discard brief", exact: true }).count()).toBe(mode === "empty" || mode === "ready" ? 1 : 0);
            if (mode === "empty") {
              const done = page.getByRole("button", { name: "All sources added", exact: true });
              expect(await done.count()).toBe(1);
              expect(await done.isVisible()).toBe(true);
              expect(await done.isDisabled()).toBe(true);
            }
            const send = page.getByRole("button", { name: "Send", exact: true });
            if (await send.count()) {
              const shape = await send.evaluate(node => {
                const { width, height } = node.getBoundingClientRect();
                return { width, height, radius: parseFloat(getComputedStyle(node).borderTopLeftRadius) };
              });
              expect(shape.width).toBe(shape.height);
              expect(shape.radius).toBeGreaterThanOrEqual(shape.height / 2);
            }
            if (mode === "ready") await page.getByRole("button", { name: "Preview Singapore, February 1942.pdf", exact: true }).waitFor();
            if (mode === "generating" || mode === "review") {
              await page.getByRole("progressbar", { name: "Generation steps", exact: true }).waitFor();
              for (const name of ["Discard", "Continue", "Resolve issues"]) {
                expect(await page.locator('[data-review-dock]').getByRole("button", { name, exact: true }).isDisabled()).toBe(mode === "generating");
              }
              for (const name of ["Discard"]) {
                const circle = await page.locator('[data-review-dock]').getByRole("button", { name, exact: true }).evaluate(node => {
                  const button = node.getBoundingClientRect();
                  const icon = node.querySelector("svg")!.getBoundingClientRect();
                  return { width: button.width, height: button.height, radius: getComputedStyle(node).borderRadius, offsetX: Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2), offsetY: Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2) };
                });
                expect(circle.width).toBe(40);
                expect(circle.height).toBe(40);
                expect(circle.radius).toBe("50%");
                expect(circle.offsetX).toBeLessThanOrEqual(1);
                expect(circle.offsetY).toBeLessThanOrEqual(1);
              }
              const controls = await page.locator('[data-review-toolbar]').evaluate(toolbar => {
                const rect = (selector: string) => { const { x, y, width, height } = toolbar.querySelector(selector)!.getBoundingClientRect(); return { x, y, width, height }; };
                return { discard: rect('[aria-label="Discard"]'), primary: rect(':scope > button:nth-of-type(2)'), resolve: rect('[data-review-resolve]') };
              });
              if (mode === "generating") generatingControls = controls;
              else expect(controls).toEqual(generatingControls);
              expect(controls.primary.x - controls.discard.x - controls.discard.width).toBe(8);
              const progressBounds = await page.locator('[data-toolbar-progress]').boundingBox();
              const continueBounds = await page.locator('[data-review-dock]').getByRole("button", { name: "Continue", exact: true }).boundingBox();
              const resolveBounds = await page.locator('[data-review-dock]').getByRole("button", { name: "Resolve issues", exact: true }).boundingBox();
              expect(progressBounds!.x).toBeGreaterThanOrEqual(continueBounds!.x + continueBounds!.width);
              expect(progressBounds!.x + progressBounds!.width).toBeLessThanOrEqual(resolveBounds!.x);
              expect(progressBounds!.width).toBeGreaterThan(100);
              const order = await page.locator('[data-review-toolbar]').evaluate(toolbar => Array.from(toolbar.querySelectorAll("button")).map(button => button.getBoundingClientRect()).filter(box => box.width > 0).map(box => box.x));
              expect(order).toEqual([...order].sort((a, b) => a - b));
              expect(await page.locator('[data-review-toolbar]').evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(76);
              expect(await page.locator('[data-review-toolbar]').evaluate(node => getComputedStyle(node).borderTopLeftRadius)).toBe("28px");
              expect(await page.getByRole("button", { name: "Resolve issues", exact: true }).innerText()).toBe("Resolve issues");
              if (mode === "review") {
                // Dialogs opened from the nowrap toolbar still wrap their text.
                await page.locator("[data-review-dock]").getByRole("button", { name: "Discard", exact: true }).click();
                const confirm = page.getByRole("dialog");
                await confirm.waitFor();
                expect(await confirm.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
                await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
              }
              expect(await page.locator('[data-review-dock] [aria-label="Generation progress"]').count()).toBe(1);
              expect(await page.locator('[data-generated-content] [aria-label="Generation progress"]').count()).toBe(0);
            } else {
              expect(await page.locator('[aria-label="Generation progress"]').count()).toBe(0);
            }
            const bounds = await page.evaluate(() => {
              const chat = document.querySelector('[aria-label="Adventure conversation"]')!;
              const generated = document.querySelector("[data-generated-content]")!;
              return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, chatBottom: chat.getBoundingClientRect().bottom, chatHeight: chat.getBoundingClientRect().height, generatedBottom: generated.getBoundingClientRect().bottom, chatHeadings: chat.querySelectorAll("h1,h2").length, chatBackground: getComputedStyle(chat).backgroundColor, theme: document.documentElement.dataset.theme, rootSurface: getComputedStyle(document.documentElement).getPropertyValue("--surface"), localSurface: getComputedStyle(chat).getPropertyValue("--surface") };
            });
            expect(bounds.pageWidth).toBeLessThanOrEqual(viewport.width);
            expect(bounds.pageHeight).toBeLessThanOrEqual(viewport.height + 1);
            expect(bounds.chatBottom).toBeLessThanOrEqual(viewport.height);
            expect(bounds.chatBottom).toBeGreaterThan(viewport.height - 30);
            expect(bounds.chatHeight).toBeGreaterThan(viewport.height * .65);
            expect(bounds.chatHeadings).toBe(0);
            if (bounds.chatBackground !== (theme === "dark" ? "rgb(26, 35, 50)" : "rgb(255, 253, 248)")) {
              await writeFile(resolve(output, "theme-styles.css"), await page.evaluate(() => Array.from(document.querySelectorAll("style")).map((node) => node.textContent).join("\n")));
            }
            expect(bounds.chatBackground, JSON.stringify(bounds)).toBe(theme === "dark" ? "rgb(26, 35, 50)" : "rgb(255, 253, 248)");
            if (mode !== "empty") {
              const columns = await page.locator("[data-source-grid]").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
              expect(columns).toBe(2);
              if (theme === "dark") {
                const stamp = await page.locator("[data-source-tile] svg").first().evaluate((node) => getComputedStyle(node).color);
                const eye = await page.locator("[data-source-tile] button svg").first().evaluate((node) => getComputedStyle(node).color);
                expect(stamp).toBe("rgb(196, 211, 255)");
                expect(eye).toBe("rgb(181, 189, 203)");
                let pencil: string | null = null;
                if (mode === "ready") {
                  pencil = await page.getByRole("button", { name: "Change timer", exact: true }).locator("svg").evaluate((node) => getComputedStyle(node).color);
                  expect(pencil).toBe("rgb(181, 189, 203)");
                }
                measurements.push({ mode, theme, width: viewport.width, iconColors: { stamp, eye, pencil } });
              }
            }
            measurements.push({ mode, theme, ...bounds });
            await page.screenshot({ path: resolve(output, `${mode}-${viewport.width}-${theme}.png`), fullPage: true });
            if (mode === "generating" || mode === "review") await page.locator("[data-review-toolbar]").screenshot({ path: resolve(output, `bar-${mode}-${viewport.width}-${theme}.png`) });
          }
        }
      }

      // The finished draft keeps one bar: Save, then Preview and the editor link, then progress and Resolve.
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport);
        await visit("draft");
        const dock = page.locator("[data-review-dock]");
        expect(await dock.getByRole("link", { name: "Preview adventure", exact: true }).count()).toBe(1);
        expect(await dock.getByRole("link", { name: "Open adventure editor", exact: true }).count()).toBe(1);
        expect(await page.locator("[data-generated-content] a[href$='/preview']").count()).toBe(0);
        const bar = await page.locator("[data-review-toolbar]").evaluate(node => ({ height: node.getBoundingClientRect().height, overflow: node.scrollWidth > node.clientWidth + 1, progress: node.querySelector("[data-toolbar-progress]")!.getBoundingClientRect().width }));
        expect(bar.height).toBeLessThanOrEqual(76);
        expect(bar.overflow).toBe(false);
        expect(bar.progress).toBeGreaterThan(60);
        await page.locator("[data-review-toolbar]").screenshot({ path: resolve(output, `bar-draft-${viewport.width}-light.png`) });
      }

      const mobileOverflows: unknown[] = [];
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 812 });
        for (const mode of ["empty", "ready"]) {
          await visit(mode);
          const fallback = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth, overflow: Array.from(document.querySelectorAll("body *")).filter((node) => node.getBoundingClientRect().right > innerWidth + 1).map((node) => ({ tag: node.tagName, className: node.getAttribute("class"), right: node.getBoundingClientRect().right, text: node.textContent?.slice(0, 80) })) }));
          await page.screenshot({ path: resolve(output, `${mode}-${width}-fallback.png`), fullPage: true });
          if (fallback.content > width) mobileOverflows.push({ mode, ...fallback });
          measurements.push({ mode, mobileFallback: true, ...fallback });
        }
      }
      expect(mobileOverflows).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 800 });

      await visit("ready");
      const preview = page.getByRole("button", { name: "Preview Singapore, February 1942.pdf", exact: true });
      await preview.click();
      const dialog = page.getByRole("dialog", { name: "Singapore, February 1942.pdf", exact: true });
      await dialog.getByText("Stored extract from page three.", { exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, "source-preview.png"), fullPage: true });
      expect(await dialog.getByRole("button", { name: "Previous", exact: true }).isDisabled()).toBe(true);
      await dialog.getByRole("button", { name: "Next", exact: true }).click();
      await dialog.getByText("Stored extract from page seven.", { exact: true }).waitFor();
      expect(await dialog.getByRole("button", { name: "Next", exact: true }).isDisabled()).toBe(true);
      await page.keyboard.press("Escape");
      expect(await preview.evaluate((element) => document.activeElement === element)).toBe(true);
      await page.evaluate(() => { (window as unknown as { __creation: { failPreview: boolean } }).__creation.failPreview = true; });
      await page.getByRole("button", { name: "Preview Civilian accounts.md", exact: true }).click();
      const textDialog = page.getByRole("dialog", { name: "Civilian accounts.md", exact: true });
      await textDialog.getByRole("button", { name: "Try again", exact: true }).click();
      await textDialog.getByText(/First paragraph of the civilian account/).waitFor();
      expect(await textDialog.getByText(/Second paragraph of the same continuous text source/).count()).toBe(1);
      expect(await textDialog.getByRole("button", { name: "Next", exact: true }).count()).toBe(0);
      await textDialog.getByRole("button", { name: "Close source preview", exact: true }).click();

      await page.getByRole("button", { name: "Change timer", exact: true }).click();
      const answer = page.getByRole("textbox", { name: "Your answer", exact: true });
      await answer.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Your answer");
      await answer.fill("60");
      await answer.press("Enter");
      await page.getByText("60 minutes", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Create adventure", exact: true }).isEnabled()).toBe(true);

      await visit("empty");
      const uploadBounds = () => page.locator("[data-upload-box]").evaluate(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      });
      const beforeUpload = await uploadBounds();
      await page.evaluate(() => { (window as unknown as { __creation: { uploadDelay: number } }).__creation.uploadDelay = 800; });
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Choose files", exact: true }).click();
      await (await chooser).setFiles([
        { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("First source") },
        { name: "retry.md", mimeType: "text/markdown", buffer: Buffer.from("Second source") },
        { name: "third.txt", mimeType: "text/plain", buffer: Buffer.from("Third source") },
      ]);
      await page.getByText("Reading and saving…", { exact: true }).waitFor();
      expect(await uploadBounds()).toEqual(beforeUpload);
      expect(await page.locator("[data-upload-box]").getByRole("list", { name: "Source upload queue" }).count()).toBe(1);
      await page.screenshot({ path: resolve(output, "upload-in-progress.png"), fullPage: true });
      await page.getByRole("button", { name: "Retry retry.md", exact: true }).waitFor();
      await page.getByRole("button", { name: "Preview third.txt", exact: true }).waitFor();
      expect(await uploadBounds()).toEqual(beforeUpload);
      await page.evaluate(() => { (window as unknown as { __creation: { uploadDelay: number } }).__creation.uploadDelay = 180; });
      expect(await page.getByRole("button", { name: "Preview first.txt", exact: true }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Preview retry.md", exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "Retry retry.md", exact: true }).click();
      await page.getByRole("button", { name: "Preview retry.md", exact: true }).waitFor();
      expect(await uploadBounds()).toEqual(beforeUpload);
      await dropFiles(page, '[aria-label="Source material"]', ["drop-one.txt", "drop-two.md"]);
      await page.getByRole("button", { name: "Preview drop-two.md", exact: true }).waitFor();
      const queue = await page.evaluate(() => (window as unknown as { __creation: { maxInFlight: number; calls: { name: string; token: string }[]; state: { sources: { title: string }[] } } }).__creation);
      expect(queue.maxInFlight).toBe(1);
      expect(queue.calls.map((call) => call.name)).toEqual(["first.txt", "retry.md", "third.txt", "retry.md", "drop-one.txt", "drop-two.md"]);
      const retries = queue.calls.filter((call) => call.name === "retry.md");
      expect(retries[0].token).toBeTruthy();
      expect(retries[1].token).toBe(retries[0].token);
      expect(queue.state.sources.map((source) => source.title)).toEqual(["first.txt", "third.txt", "retry.md", "drop-one.txt", "drop-two.md"]);
      expect(await page.locator("[data-source-tile]").count()).toBe(5);
      await page.screenshot({ path: resolve(output, "uploaded-queue-retry.png"), fullPage: true });

      await page.locator('input[type="file"]').setInputFiles([
        { name: "unsupported.png", mimeType: "image/png", buffer: Buffer.from("Not a supported document") },
        { name: "too-big.txt", mimeType: "text/plain", buffer: Buffer.alloc(15 * 1024 * 1024 + 1, "x") },
        { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
      ]);
      await page.getByText("Only PDF, TXT and MD files are supported.", { exact: true }).waitFor();
      await page.getByText("That file exceeds the 15 MB limit.", { exact: true }).waitFor();
      await page.getByText("That file is empty. Choose a file with source material.", { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { __creation: { calls: unknown[] } }).__creation.calls.length)).toBe(6);

      await visit("cap");
      await page.locator('input[type="file"]').setInputFiles([
        { name: "capacity-one.txt", mimeType: "text/plain", buffer: Buffer.from("Source number 20") },
        { name: "capacity-two.txt", mimeType: "text/plain", buffer: Buffer.from("Exceeds source cap") },
      ]);
      await page.getByRole("button", { name: "Preview capacity-one.txt", exact: true }).waitFor();
      await page.getByText("You can add up to 20 sources. Dismiss a queued source before adding another.", { exact: true }).waitFor();
      const cap = await page.evaluate(() => (window as unknown as { __creation: { calls: { name: string }[]; state: { sources: unknown[] } } }).__creation);
      expect(cap.calls.map((call) => call.name)).toEqual(["capacity-one.txt"]);
      expect(cap.state.sources).toHaveLength(20);
      await writeFile(resolve(output, "results.json"), JSON.stringify({ fontFacesAvailable: !!fontCss, measurements, queue, rejectedUploadsMadeNoCalls: true, cap: { calls: cap.calls, sourceCount: cap.state.sources.length }, errors }, null, 2));
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await vite.close();
    }
  }, 120_000,
);

async function dropFiles(page: Page, selector: string, names: string[]) {
  const transfer = await page.evaluateHandle((filenames) => {
    const data = new DataTransfer();
    for (const name of filenames) data.items.add(new File([`Text for ${name}`], name, { type: name.endsWith(".md") ? "text/markdown" : "text/plain" }));
    return data;
  }, names);
  await page.locator(selector).dispatchEvent("dragenter", { dataTransfer: transfer });
  await page.locator(selector).dispatchEvent("dragover", { dataTransfer: transfer });
  await page.locator(selector).dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}
