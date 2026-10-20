import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === "1")(
  "edits across tabs, saves/reloads, discards and preserves work on server errors",
  async () => {
    const spec = JSON.parse(
      await readFile("fixtures/golden-1819.json", "utf8"),
    );
    const ui = await readFile("apps/web/src/components/ui.tsx", "utf8");
    const buttons = ui.slice(
      ui.indexOf("export const button"),
      ui.indexOf("export const control"),
    );
    const root = resolve("apps/web");
    const vite = await createServer({
      configFile: false,
      cacheDir: resolve("node_modules/.vite/v3-editor"),
      root,
      publicDir: false,
      server: {
        host: "127.0.0.1",
        port: 0,
        watch: null,
        fs: { allow: [resolve(".")] },
      },
      esbuild: { jsx: "automatic" },
      optimizeDeps: {
        include: ["react", "react-dom/client", "@radix-ui/react-select"],
      },
      css: { postcss: { plugins: [tailwind()] } },
      resolve: {
        alias: { "@": resolve(root, "src") },
        dedupe: ["react", "react-dom"],
      },
      plugins: [
        {
          name: "editor-harness",
          enforce: "pre",
          resolveId(id, importer) {
            if (id === "virtual:editor") return "\0editor";
            if (id === "next/link") return "\0link";
            if (id === "next/image") return "\0image";
            if (id === "next/navigation") return "\0navigation";
            if (id.endsWith("/teacher/actions") || (id === "../actions" && importer?.endsWith("/brief-chat.tsx"))) return "\0brief-actions";
            if (id.endsWith("/chat-actions")) return "\0chat";
            if (id.endsWith("/src/components/ui")) return "\0buttons";
            if (id.endsWith("/edit-actions")) return "\0save";
            if (id.endsWith("/publish-actions")) return "\0publish";
          },
          async load(id) {
            if (id === "\0buttons") return `import React from 'react'; ${buttons}
              export const control='rounded-control border border-line p-2';
              export function Thinking({label}) { return React.createElement('p',null,label); }
              export function Pending({children}) { return children; }
              export function StableLabel({label}) { return label; }
              export function ErrorText({children}) { return React.createElement('p',{role:'alert'},children); }`;
            if (id === "\0navigation") return `export function useRouter(){return {refresh(){},push(){}}}`;
            if (id === "\0brief-actions") return `export async function addV3BriefSource(){}; export async function createFromV3Brief(){}; export async function discardV3Brief(){}`;
            if (id === "\0chat") return `import {initialBriefStateV3} from '/src/lib/v3/brief/schema.ts';
              export async function suggestReviewChangeAction(id,input,text){
                if(window.chatFailure) return {ok:false,message:'Could not prepare a suggestion. Try again.'};
                const state=initialBriefStateV3(id);
                state.messages=[{role:'user',text,slot:'review'},{role:'assistant',text:'I suggest a new title.',slot:'review'}];
                return {ok:true,state,notes:'I suggest a new title.',preview:[{label:'Title',before:'Current title',after:'Chat revised title'}],proposal:{pass:'draft',edits:[...input.edits,{type:'set',path:['title'],value:'Chat revised title'}]}};
              }`;
            if (id === "\0image") return `import React from 'react'; export default function Image({fill,unoptimized,...props}) { return React.createElement('img', {...props, style:fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:undefined}); }`;
            if (id === "\0link")
              return `import React from 'react'; export default function Link(props) { return React.createElement('a', props); }`;
            if (id === "\0publish")
              return `export async function currentV3StudentLink(){return {ok:true,path:"/v3/join/fixture?release=test"}}; export async function publishV3Adventure(){return {ok:true,status:'published'}}; export async function unpublishV3Adventure(){return {ok:true,status:'draft'}}`;
            if (id === "\0save")
              return `export async function fixV3EditsWithAiAction(){return {ok:true,notes:'I corrected the title.',edits:[{type:'set',path:['title'],value:'Suggested teacher title'}]}}; import {applyV3Edits} from '/src/lib/v3/edit/commands.ts';
          export async function saveV3AdventureEdits(id,version,edits){
            if(window.saveMode==='failure') throw Error('offline');
            if(window.saveMode==='conflict') return {ok:false,code:'conflict',message:'This adventure changed. Your local edits are still here.'};
            const spec=applyV3Edits(JSON.parse(localStorage.getItem('spec')),edits,[]);
            localStorage.setItem('spec',JSON.stringify(spec)); localStorage.setItem('version',String(version+1));
            return {ok:true,spec,version:version+1,errors:[{code:"fixture",path:"characters.0.persona.voice",message:"Check this character voice"}],warnings:[]};
          }`;
            if (id === "\0editor")
              return (
                await transformWithEsbuild(
                  `
          import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdventureSpec} from '@adventure/spec-v3';
          import {EditorWorkspace} from '/src/app/v3/teacher/[id]/review/editor-workspace.tsx'; import '/src/app/globals.css';
          import {EditorChatWorkspace} from '/src/app/v3/teacher/[id]/review/editor-chat-workspace.tsx';
          import {initialBriefStateV3} from '/src/lib/v3/brief/schema.ts';
          if(!localStorage.getItem('spec')) localStorage.setItem('spec',${JSON.stringify(JSON.stringify(spec))});
          const spec=AdventureSpec.parse(JSON.parse(localStorage.getItem('spec'))); localStorage.setItem('spec',JSON.stringify(spec));
          createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-[100rem] p-5"><EditorChatWorkspace brief={initialBriefStateV3('fixture')}><EditorWorkspace adventureId="fixture" initial={spec} initialVersion={Number(localStorage.getItem('version')||1)} publishedVersion={1} published={true} sources={spec.sources} capturedSources={[]} assets={{version:Number(localStorage.getItem('version')||1),items:[{id:'painting',kind:'stage',title:'Stage artwork fixture',description:'Fixture scenery',url:'/asset-fixture.svg',version:1},{id:'portrait',kind:'portrait',title:'Portrait awaiting generation',description:'No portrait yet',url:null,version:null}]}} errors={new URLSearchParams(location.search).has('clean')?[]:[{code:'fixture',path:'characters.0.persona.voice',message:'Check this character voice'}]} warnings={[]} /></EditorChatWorkspace></main>);
        `,
                  "editor.tsx",
                  { loader: "tsx", jsx: "automatic" },
                )
              ).code;
          },
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url === "/asset-fixture.svg") {
                res.setHeader("Content-Type", "image/svg+xml");
                res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#d6c4a0"/></svg>');
                return;
              }
              if (req.url?.split("?")[0] !== "/") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__editor"></script></body></html>',
              );
            });
          },
        },
      ],
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await vite.listen();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error(e.message);
      });
      page.on("console", (m) => {
        if (m.type() === "error") console.error(m.text());
      });
      await page.goto(`${vite.resolvedUrls!.local[0]!}?clean=1`);
      await page.getByText("No issues", { exact: true }).waitFor();
      expect(await page.getByRole("group", { name: "Adventure checks" }).count()).toBe(0);
      await page.goto(vite.resolvedUrls!.local[0]!);
      expect(await page.getByRole("region", { name: "Adventure conversation" }).count()).toBe(0);
      await page.getByRole("tab", { name: "Generated assets", exact: true }).click();
      await page.getByRole("heading", { name: "Stage artwork", exact: true }).waitFor();
      await page.getByRole("link", { name: "Open full image", exact: true }).waitFor();
      expect(await page.getByText("Image not available for this version.", { exact: true }).count()).toBe(1);
      expect(await page.getByRole("navigation", { name: "Stages items" }).count()).toBe(0);
      await page.screenshot({ path: "/tmp/v3-editor-assets-desktop.png", fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: "/tmp/v3-editor-assets-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("tab", { name: "Stages", exact: true }).click();
      const issues = page.getByRole("group", { name: "Adventure checks" });
      await issues.waitFor();
      expect(await issues.locator("summary").first().innerText()).toBe("1 issue to fix");
      expect(await issues.getAttribute("open")).toBeNull();
      expect(await issues.locator("summary").first().innerText()).toMatch(/\d+ issues? to fix/);
      await issues.locator("summary").first().focus();
      await page.keyboard.press("Enter");
      expect(await issues.locator("li details").first().getAttribute("open")).not.toBeNull();
      await issues.getByRole("button", { name: "Check this character voice", exact: true }).click();
      const voice = page.locator("#edit-characters-0-persona-voice");
      await voice.waitFor();
      expect(await voice.evaluate((element) => document.activeElement === element)).toBe(true);
      const fieldIssue = page.locator('[data-edit-path="characters.0.persona.voice"]');
      expect(await fieldIssue.innerText()).toContain("Check this character voice");
      expect(await fieldIssue.getAttribute("aria-describedby")).toBeTruthy();
      expect(await page.getByRole("tab", { name: "Characters", exact: true }).getAttribute("aria-selected")).toBe("true");
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const height of [1000, 720]) {
        await page.setViewportSize({ width: 1440, height });
        await page.waitForTimeout(150);
        const chat = await page.getByRole("region", { name: "Adventure conversation" }).boundingBox();
        const index = await page.getByRole("navigation", { name: "Characters items" }).boundingBox();
        const content = await page.getByRole("region", { name: "Review details" }).boundingBox();
        const composer = await page.getByRole("textbox", { name: "Message", exact: true }).boundingBox();
        expect(Math.abs(chat!.y - index!.y)).toBeLessThan(2);
        expect(Math.abs(chat!.y - content!.y)).toBeLessThan(2);
        expect(chat!.width).toBeGreaterThanOrEqual(300);
        expect(chat!.y + chat!.height).toBeLessThanOrEqual(height);
        expect(composer!.y + composer!.height).toBeLessThanOrEqual(chat!.y + chat!.height);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: "/tmp/v3-editor-field-errors-desktop.png", fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: "/tmp/v3-editor-field-errors-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "Discard edits", exact: true }).click();
      await page.getByRole("tab", { name: "Stages", exact: true }).click();
      expect(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("button", { name: "Discard edits", exact: true })
          .count(),
      ).toBe(0);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Defining Moment", exact: true })
        .first()
        .click();
      const option = page.getByRole("option", {
        name: spec.definingMoments[0].scene,
        exact: true,
      });
      await option.waitFor();
      expect(await option.innerText()).toBe(spec.definingMoments[0].scene);
      expect(
        await option.evaluate(
          (e) => getComputedStyle(e.querySelector("span")!).whiteSpace,
        ),
      ).toBe("normal");
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(
        await page
          .getByRole("button", { name: "Discard edits", exact: true })
          .isVisible(),
      ).toBe(true);
      expect(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
      ).toBe(0);
      await page.locator("#edit-title").fill("A saved teacher title");
      await page.getByRole("tab", { name: "Generated assets", exact: true }).click();
      await page.getByRole("heading", { name: "Generated assets", exact: true }).waitFor();
      expect(await page.getByRole("region", { name: "Adventure conversation" }).count()).toBe(0);
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("A saved teacher title");
      expect(await page.getByRole("region", { name: "Adventure conversation" }).count()).toBe(1);
      expect(
        await page.getByRole("button", { name: "Edit", exact: true }).count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("button", { name: "Preview", exact: true })
          .isDisabled(),
      ).toBe(true);
      await page.getByRole("tab", { name: "Characters", exact: true }).click();
      await page
        .locator("#edit-characters-0-persona-voice")
        .fill("A changed teacher voice");
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Saved version 2" })
        .waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      await page.locator("#edit-title").fill("Unsaved");
      page.once("dialog", (d) => d.dismiss());
      await page.getByRole("link", { name: "Back to adventures" }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("Unsaved");
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Discard edits", exact: true })
        .click();
      expect(
        await page
          .getByRole("button", { name: "Edit", exact: true })
          .isVisible(),
      ).toBe(true);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      for (const mode of ["failure", "conflict"]) {
        await page.locator("#edit-title").fill("Keep this local work");
        await page.evaluate((m) => {
          (window as unknown as { saveMode: string }).saveMode = m;
        }, mode);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.getByRole("alert").waitFor();
        expect(await page.locator("#edit-title").inputValue()).toBe(
          "Keep this local work",
        );
        expect(
          await page
            .getByRole("button", { name: "Reload saved version" })
            .isVisible(),
        ).toBe(true);
      }
      await page
        .getByRole("button", { name: "Resolve issues", exact: true })
        .click();
      await page.getByText("I corrected the title.", { exact: true }).waitFor();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "Keep this local work",
      );
      await page
        .getByRole("button", { name: "Keep my edits", exact: true })
        .click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "Keep this local work",
      );
      await page
        .getByRole("button", { name: "Resolve issues", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Apply suggested fix", exact: true })
        .waitFor();
      await page.locator("#edit-title").fill("Another teacher change");
      expect(
        await page
          .getByRole("button", { name: "Apply suggested fix", exact: true })
          .count(),
      ).toBe(0);
      await page
        .getByRole("button", { name: "Resolve issues", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Apply suggested fix", exact: true })
        .click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "Suggested teacher title",
      );
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("spec")!).title,
        ),
      ).toBe("A saved teacher title");
      // Chat uses the same local draft and leaves saving/publishing explicit.
      const message = page.getByRole("textbox", { name: "Message", exact: true });
      await message.fill("Give this a clearer title");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("region", { name: "Suggested changes" }).waitFor();
      await page.setViewportSize({ width: 1440, height: 720 });
      await page.waitForTimeout(150);
      const suggestionComposer = await message.boundingBox();
      expect(suggestionComposer!.y + suggestionComposer!.height).toBeLessThanOrEqual(720);
      await page.setViewportSize({ width: 1440, height: 1000 });
      expect(await page.locator("#edit-title").inputValue()).toBe("Suggested teacher title");
      await page.getByRole("button", { name: "Keep my edits", exact: true }).click();
      await message.fill("Give this a clearer title");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("button", { name: "Apply changes", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("Chat revised title");
      expect(await page.getByText("Unpublished changes", { exact: false }).count()).toBeGreaterThan(0);
      await page.evaluate(() => { window.saveMode = 'success'; });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Saved version 3" }).waitFor();
      expect(await page.getByRole("region", { name: "Adventure conversation" }).count()).toBe(0);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("Chat revised title");
      expect(await page.locator("#edit-characters-0-persona-voice").count()).toBe(0);
      await page.getByRole("tab", { name: "Characters", exact: true }).click();
      expect(await page.locator("#edit-characters-0-persona-voice").inputValue()).toBe("A changed teacher voice");
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await message.fill("Another suggestion");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("button", { name: "Apply changes", exact: true }).waitFor();
      await page.locator("#edit-title").fill("Newer manual title");
      expect(await page.getByRole("button", { name: "Apply changes", exact: true }).count()).toBe(0);
      await page.evaluate(() => { window.chatFailure = true; });
      await message.fill("Keep my request on failure");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByText("Could not prepare a suggestion. Try again.", { exact: true }).waitFor();
      expect(await message.inputValue()).toBe("Keep my request on failure");
      for (const width of [1440, 375, 320]) {
        await page.setViewportSize({ width, height: 812 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.getByRole("tab", { name: "Settings", exact: true }).focus();
        await page.keyboard.press("ArrowRight");
        expect(
          await page
            .getByRole("tab", { name: "Reveal and questions" })
            .getAttribute("aria-selected"),
        ).toBe("true");
        await page.getByRole("tab", { name: "Settings", exact: true }).click();
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "/tmp/v3-editor-toolbar-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({
        path: "/tmp/v3-editor-toolbar-mobile.png",
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
  90_000,
);
