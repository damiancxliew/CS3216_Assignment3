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
    const { reviewAssets } = await import("@/lib/v3/review-assets");
    const inventory = reviewAssets(spec, "fixture", 1).map((asset, index) => ({
      ...asset,
      url:
        index === 0
          ? "/asset-fixture.svg"
          : asset.kind === "sprite"
            ? asset.url
            : null,
    }));
    const vite = await createServer({
      configFile: false,
      cacheDir: resolve("node_modules/.vite/v3-editor"),
      root,
      publicDir: resolve("apps/web/public"),
      define: {
        "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined",
        "process.env.ASSET_BUCKET": "undefined",
      },
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
            if (id.endsWith("/upgrade-actions")) return "\0upgrades";
            if (id.endsWith("/src/components/ui")) return "\0buttons";
            if (id.endsWith("/media-actions")) return "\0media";
            if (id.endsWith("/edit-actions")) return "\0save";
            if (id.endsWith("/publish-actions")) return "\0publish";
            if (id.endsWith("/version-actions")) return "\0versions";
            if (id === "./import-actions" || id.endsWith("/teacher/import-actions")) return "\0import-json";
            if (id.endsWith("/lib/analytics/posthog")) return "\0analytics";
          },
          async load(id) {
            if (id === "\0versions") return `export async function getV3SavedVersions(){return {ok:true,latest:1,publishedVersion:1,published:true,versions:[]}}`;
            if (id === "\0import-json") return `export async function importAdventureJson(previous,form){return {error:form.get('file').name.endsWith('.zip')?'Could not import ZIP.':'That file is not valid JSON.'}}; export async function updateAdventureFromZip(){return {error:'This adventure changed. Reload before importing.'}}`;
            if (id === "\0analytics") return `export function track(){}`;
            if (id === "\0buttons") return `import React from 'react'; ${buttons}
              export const control='rounded-control border border-line p-2';
              export function Thinking({label}) { return React.createElement('p',null,label); }
              export function Pending({children}) { return children; }
              export function StableLabel({label}) { return label; }
              export function ErrorText({children}) { return React.createElement('p',{role:'alert'},children); }`;
            if (id === "\0upgrades") return `export const getUpgradeAction=async()=>null; export const startUpgradeAction=async()=>({ok:false,message:"Unavailable"}); export const refineUpgradeAction=startUpgradeAction; export const applyUpgradeAction=startUpgradeAction; export const discardUpgradeAction=startUpgradeAction;`;
            if (id === "\0navigation")
              return `export function useSearchParams(){return new URLSearchParams(location.search)}; export function useRouter(){return {refresh(){},push(){}}}`;
            if (id === "\0brief-actions")
              return `export async function addV3BriefSource(){}; export async function createFromV3Brief(){}; export async function discardV3Brief(){}`;
            if (id === "\0chat")
              return `import {initialBriefStateV3} from '/src/lib/v3/brief/schema.ts';
              export async function suggestReviewChangeAction(id,input,text){
                if(window.chatFailure) return {ok:false,message:'Could not prepare a suggestion. Try again.'};
                const state=initialBriefStateV3(id);
                state.messages=[{role:'user',text,slot:'review'},{role:'assistant',text:'I suggest a new title.',slot:'review'}];
                return {ok:true,state,notes:'I suggest a new title.',preview:[{label:'Title',before:'Current title',after:'Chat revised title'}],proposal:{pass:'draft',edits:[...input.edits,{type:'set',path:['title'],value:'Chat revised title'}]}};
              }`;
            if (id === "\0image")
              return `import React from 'react'; export default function Image({fill,unoptimized,...props}) { return React.createElement('img', {...props, style:fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:undefined}); }`;
            if (id === "\0link")
              return `import React from 'react'; export default function Link(props) { return React.createElement('a', props); }`;
            if (id === "\0publish")
              return `export async function publishSavedV3Version(){return {ok:true,status:'published'}}; export async function currentV3StudentLink(){return {ok:true,path:"/v3/join/fixture?release=test"}}; export async function publishV3Adventure(){return {ok:true,status:'published'}}; export async function unpublishV3Adventure(){return {ok:true,status:'draft'}}`;
            if (id === "\0media")
              return `export async function loadMediaAction(){return {items:JSON.parse(localStorage.getItem('media')||'[]')}};
              export async function uploadMediaAction(adventureId,form){const input=JSON.parse(form.get('input'));const file=form.get('file');const url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file)});const id=crypto.randomUUID();const item={id,adventureId,creatorId:'teacher',target:input.target,origin:'upload',state:'ready',snapshot:{candidateId:id,origin:'upload',url:new URL('/game/ninja/characters/Noble/walk.png',location.origin).href,storageKey:'v3/media/fixture/'+id+'/image.png',format:'png',width:64,height:64,caption:input.caption,alt:input.alt,credit:input.credit,...(input.target.kind.includes('Sprite')?{spriteLayout:'4x4-down-up-left-right'}:{})},specVersion:input.version,failure:null,costUsd:0,createdAt:new Date().toISOString()};const items=JSON.parse(localStorage.getItem('media')||'[]');items.push(item);localStorage.setItem('media',JSON.stringify(items));return {item};}
              export async function createMediaAction(id,input){if(input.referenceCandidateId){window.stanceRequests=[...(window.stanceRequests||[]),input];const item={id:crypto.randomUUID(),adventureId:id,target:input.target,origin:'ai',state:'pending',snapshot:null,specVersion:input.version,failure:null,costUsd:0,createdAt:new Date().toISOString()};const items=JSON.parse(localStorage.getItem('media')||'[]');items.push(item);localStorage.setItem('media',JSON.stringify(items));return {item}};window.candidateKeys=[...(window.candidateKeys||[]),input.key];throw Error('Response lost in browser fixture')};export async function searchImagesAction(){return {items:[],nextPage:null}};`;
            if (id === "\0save")
              return `export async function fixV3EditsWithAiAction(){return {ok:true,notes:'I corrected the title.',edits:[{type:'set',path:['title'],value:'Suggested teacher title'}]}}; import {applyV3Edits} from '/src/lib/v3/edit/commands.ts';
          export async function saveV3AdventureEdits(id,version,edits){
            if(window.saveMode==='failure') throw Error('offline');
            if(window.saveMode==='conflict') return {ok:false,code:'conflict',message:'This adventure changed. Your local edits are still here.'};
            const candidates=Object.fromEntries(JSON.parse(localStorage.getItem('media')||'[]').map(item=>[item.id,item])); const spec=applyV3Edits(JSON.parse(localStorage.getItem('spec')),edits,[],true,{candidates});
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
          import {ImportAdventureJson} from '/src/app/v3/teacher/import-json.tsx';
          if(!localStorage.getItem('spec')) localStorage.setItem('spec',${JSON.stringify(JSON.stringify(spec))});
          const spec=AdventureSpec.parse(JSON.parse(localStorage.getItem('spec'))); localStorage.setItem('spec',JSON.stringify(spec));
          createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-[100rem] p-5"><ImportAdventureJson /><EditorChatWorkspace brief={initialBriefStateV3('fixture')}><EditorWorkspace adventureId="fixture" initial={spec} initialVersion={Number(localStorage.getItem('version')||1)} publishedVersion={1} published={true} sources={spec.sources} capturedSources={[]} assets={{version:Number(localStorage.getItem('version')||1),items:${JSON.stringify(inventory)}.map(asset=>({...asset,url:asset.url?.startsWith('/')?new URL(asset.url,location.origin).href:asset.url}))}} errors={new URLSearchParams(location.search).has('clean')?[]:[{code:'fixture',path:'characters.0.persona.voice',message:'Check this character voice'}]} warnings={[]} /></EditorChatWorkspace></main>);
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
                res.end(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#d6c4a0"/></svg>',
                );
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
      await page.locator("summary").filter({ hasText: /^Import adventure$/ }).click();
      await page.getByLabel("ZIP or JSON file", { exact: true }).setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{broken") });
      await page.getByRole("button", { name: "Import adventure", exact: true }).click();
      await page.getByText("That file is not valid JSON.", { exact: true }).waitFor();
      await page.getByLabel("ZIP or JSON file", { exact: true }).setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("broken zip") });
      await page.getByRole("button", { name: "Import adventure", exact: true }).click();
      await page.getByText("Could not import ZIP.", { exact: true }).waitFor();
      await page.screenshot({ path: "/tmp/v3-json-import.png", fullPage: true });
      await page.getByRole("button", { name: "Import / export", exact: true }).click();
      expect(await page.getByRole("link", { name: "Download JSON", exact: true }).getAttribute("href")).toBe("/api/v3/adventures/fixture/export");
      expect(await page.getByRole("link", { name: "Download ZIP", exact: true }).getAttribute("href")).toBe("/api/v3/adventures/fixture/export?format=zip");
      await page.getByRole("button", { name: "Close import and export", exact: true }).click();
      expect(
        await page.getByRole("group", { name: "Adventure checks" }).count(),
      ).toBe(0);
      await page.goto(vite.resolvedUrls!.local[0]!);
      expect(
        await page
          .getByRole("region", { name: "Adventure conversation" })
          .count(),
      ).toBe(0);
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      await page
        .getByRole("heading", { name: "Stage openings", exact: true })
        .waitFor();
      await page
        .getByRole("link", { name: "Open full image", exact: true })
        .first()
        .waitFor();
      expect(
        await page.getByText("No image selected.", { exact: true }).count(),
      ).toBe(inventory.filter((asset) => asset.url === null).length);
      expect(
        await page.getByRole("navigation", { name: "Stages items" }).count(),
      ).toBe(0);
      await page.screenshot({
        path: "/tmp/v3-editor-assets-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 375, height: 812 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "/tmp/v3-editor-assets-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("tab", { name: "Stages", exact: true }).click();
      const issues = page.getByRole("group", { name: "Adventure checks" });
      await issues.waitFor();
      expect(await issues.locator("summary").first().innerText()).toBe(
        "1 issue to fix",
      );
      expect(await issues.getAttribute("open")).toBeNull();
      expect(await issues.locator("summary").first().innerText()).toMatch(
        /\d+ issues? to fix/,
      );
      await issues.locator("summary").first().focus();
      await page.keyboard.press("Enter");
      expect(
        await issues.locator("li details").first().getAttribute("open"),
      ).not.toBeNull();
      await issues
        .getByRole("button", {
          name: "Check this character voice",
          exact: true,
        })
        .click();
      const voice = page.locator("#edit-characters-0-persona-voice");
      await voice.waitFor();
      expect(
        await voice.evaluate((element) => document.activeElement === element),
      ).toBe(true);
      const fieldIssue = page.locator(
        '[data-edit-path="characters.0.persona.voice"]',
      );
      expect(await fieldIssue.innerText()).toContain(
        "Check this character voice",
      );
      expect(await fieldIssue.getAttribute("aria-describedby")).toBeTruthy();
      expect(
        await page
          .getByRole("tab", { name: "Characters", exact: true })
          .getAttribute("aria-selected"),
      ).toBe("true");
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const height of [1000, 720]) {
        await page.setViewportSize({ width: 1440, height });
        await page.waitForTimeout(150);
        // Read all geometry in one browser frame while smooth focus scrolling may still run.
        const { chat, index, content, composer } = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
          return {
            chat: rect('[aria-label="Adventure conversation"]'),
            index: rect('[aria-label="Characters items"]'),
            content: rect('[aria-label="Review details"]'),
            composer: rect('[aria-label="Message"]'),
          };
        });
        expect(Math.abs(chat!.y - index!.y)).toBeLessThan(2);
        expect(Math.abs(chat!.y - content!.y)).toBeLessThan(2);
        expect(chat!.width).toBeGreaterThanOrEqual(300);
        expect(chat!.y + chat!.height).toBeLessThanOrEqual(height);
        expect(composer!.y + composer!.height).toBeLessThanOrEqual(
          chat!.y + chat!.height,
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "/tmp/v3-editor-field-errors-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 375, height: 812 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "/tmp/v3-editor-field-errors-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole("button", { name: "Discard edits", exact: true })
        .click();
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
      expect(await page.getByRole("button", { name: "Import / export", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      await page
        .getByRole("heading", { name: "Assets", exact: true })
        .waitFor();
      expect(
        await page
          .getByRole("region", { name: "Adventure conversation" })
          .count(),
      ).toBe(0);
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "A saved teacher title",
      );
      expect(
        await page
          .getByRole("region", { name: "Adventure conversation" })
          .count(),
      ).toBe(1);
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
      expect(await page.getByRole("button", { name: "Import / export", exact: true }).isEnabled()).toBe(true);
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
      const message = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await message.fill("Give this a clearer title");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.getByRole("region", { name: "Suggested changes" }).waitFor();
      await page.setViewportSize({ width: 1440, height: 720 });
      await page.waitForTimeout(150);
      const suggestionComposer = await message.boundingBox();
      expect(
        suggestionComposer!.y + suggestionComposer!.height,
      ).toBeLessThanOrEqual(720);
      await page.setViewportSize({ width: 1440, height: 1000 });
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "Suggested teacher title",
      );
      await page
        .getByRole("button", { name: "Keep my edits", exact: true })
        .click();
      await message.fill("Give this a clearer title");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "Chat revised title",
      );
      expect(
        await page.getByText("Unpublished changes", { exact: false }).count(),
      ).toBeGreaterThan(0);
      await page.evaluate(() => {
        window.saveMode = "success";
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Saved version 3" })
        .waitFor();
      expect(
        await page
          .getByRole("region", { name: "Adventure conversation" })
          .count(),
      ).toBe(0);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe(
        "Chat revised title",
      );
      expect(
        await page.locator("#edit-characters-0-persona-voice").count(),
      ).toBe(0);
      await page.getByRole("tab", { name: "Characters", exact: true }).click();
      expect(
        await page.locator("#edit-characters-0-persona-voice").inputValue(),
      ).toBe("A changed teacher voice");
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await message.fill("Another suggestion");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Apply changes", exact: true })
        .waitFor();
      await page.locator("#edit-title").fill("Newer manual title");
      expect(
        await page
          .getByRole("button", { name: "Apply changes", exact: true })
          .count(),
      ).toBe(0);
      await page.evaluate(() => {
        window.chatFailure = true;
      });
      await message.fill("Keep my request on failure");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page
        .getByText("Could not prepare a suggestion. Try again.", {
          exact: true,
        })
        .waitFor();
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
      // Drop validation and character-wide portrait selection, with queued reference variants.
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      const portraitSlot = page.locator('[id^="asset-portrait-"]').first();
      await portraitSlot.getByRole("button", { name: "Upload", exact: true }).click();
      const dropzone = portraitSlot.getByText("Drop an image here, or choose a file.").locator("..");
      await dropzone.evaluate(element => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["bad"], "bad.txt", { type: "text/plain" }));
        element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
      });
      await portraitSlot.getByRole("alert").filter({ hasText: "Choose a JPEG, PNG or WebP image." }).waitFor();
      const imageBytes = [...await readFile("apps/web/public/game/ninja/characters/Noble/walk.png")];
      await dropzone.evaluate((element, bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], "portrait.png", { type: "image/png" }));
        element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
      }, imageBytes);
      const portraitCandidate = portraitSlot.getByRole("article", { name: "Asset candidate" });
      const beforeAssetsVersion = await page.evaluate(() => localStorage.getItem("version"));
      await portraitCandidate.getByRole("button", { name: "Use for all stances", exact: true }).click();
      await portraitSlot.getByText("Unsaved selection", { exact: false }).waitFor();
      expect(await page.evaluate(() => localStorage.getItem("version"))).toBe(beforeAssetsVersion);
      const portraitSaved = await page.evaluate(() => {
        const draft = JSON.parse(localStorage.getItem("v3-editor-draft:fixture")!);
        return draft.edits.find((edit: any) => edit.type === "portraitImage");
      });
      const firstCharacter = spec.characters.find((c: any) => c.tier === "major");
      expect(portraitSaved.allStances).toBe(true);
      await portraitCandidate.getByRole("button", { name: "Generate other stances", exact: true }).click();
      await portraitCandidate.getByRole("status").filter({ hasText: "stance candidates queued" }).waitFor();
      const stanceRequests = await page.evaluate(() => (window as any).stanceRequests);
      expect(stanceRequests).toHaveLength(firstCharacter.stances.length - 1);
      expect(new Set(stanceRequests.map((r: any) => r.referenceCandidateId)).size).toBe(1);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await portraitCandidate.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "/tmp/v3-portrait-stances-desktop.png" });
      await page.setViewportSize({ width: 320, height: 850 });
      await portraitCandidate.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: "/tmp/v3-portrait-stances-mobile.png" });
      // Review and select a walking-sheet upload without losing the unsaved story title.
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      const stageSlot = page.locator('[id^="asset-stage-"]').first();
      await stageSlot.getByRole("button", { name: "Upload", exact: true }).click();
      const chooseImage = stageSlot.getByRole("button", { name: "Choose image", exact: true });
      await chooseImage.waitFor();
      await stageSlot.getByRole("textbox", { name: "Alternative text", exact: true }).fill("");
      expect(await chooseImage.isDisabled()).toBe(true);
      await stageSlot.getByRole("textbox", { name: "Alternative text", exact: true }).fill("Council chamber");
      await chooseImage.click({ trial: true });
      await chooseImage.focus();
      const imageChooser = page.waitForEvent("filechooser");
      await chooseImage.press("Enter");
      await (await imageChooser).setFiles([]);
      await chooseImage.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "/tmp/v3-asset-upload-button-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await chooseImage.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "/tmp/v3-asset-upload-button-desktop.png" });
      await stageSlot.getByRole("button", { name: "Close controls", exact: true }).click();
      const playerSlot = page.locator('[id="asset-sprite-player"]');
      await playerSlot.getByRole("button", { name: "Generate with AI", exact: true }).click();
      await playerSlot.getByRole("textbox", { name: "Appearance description" }).fill("Period interpreter");
      for (let request = 0; request < 2; request++) {
        await playerSlot.getByRole("button", { name: "Generate candidate", exact: true }).click();
        await playerSlot.getByText("Could not create candidate. Try again.", { exact: true }).waitFor();
      }
      const candidateKeys = await page.evaluate(() => (window as unknown as { candidateKeys: string[] }).candidateKeys);
      expect(candidateKeys).toHaveLength(2);
      expect(candidateKeys[1]).toBe(candidateKeys[0]);
      await playerSlot.getByRole("button", { name: "Upload sheet", exact: true }).click();
      const sheetChooser = page.waitForEvent("filechooser");
      await playerSlot.getByRole("button", { name: "Choose walking sheet", exact: true }).click();
      await (await sheetChooser).setFiles("apps/web/public/game/ninja/characters/Noble/walk.png");
      const candidate = playerSlot.getByRole("article", { name: "Asset candidate" });
      await candidate.getByRole("button", { name: "Use sheet", exact: true }).waitFor();
      expect(await candidate.getByRole("button", { name: "Use sheet", exact: true }).isDisabled()).toBe(true);
      await candidate.getByLabel("I reviewed all four labelled directions and animation frames.").check();
      await candidate.getByRole("button", { name: "Use sheet", exact: true }).click();
      await playerSlot.getByText(/Unsaved selection/).waitFor();
      expect(await page.evaluate(() => localStorage.getItem("version"))).toBe(beforeAssetsVersion);
      page.once("dialog", dialog => dialog.accept());
      await page.goto("about:blank");
      await page.goto(vite.resolvedUrls!.local[0]!);
      await page.getByRole("status").filter({ hasText: "Recovered your unsaved draft" }).waitFor();
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      await playerSlot.getByText(/Unsaved selection/).waitFor();
      expect(await playerSlot.getByRole("button", { name: "Selected", exact: true }).count()).toBe(1);
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("Newer manual title");
      await page.evaluate(() => { window.saveMode = "conflict"; });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "This adventure changed" }).waitFor();
      expect(await page.evaluate(() => localStorage.getItem("v3-editor-draft:fixture"))).not.toBeNull();
      await page.evaluate(() => { window.saveMode = "success"; });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Saved version" }).waitFor();
      expect(await page.evaluate(() => Number(localStorage.getItem("version")))).toBe(Number(beforeAssetsVersion) + 1);
      expect(await page.evaluate(() => localStorage.getItem("v3-editor-draft:fixture"))).toBeNull();
      const assetSavedSpec = await page.evaluate(() => JSON.parse(localStorage.getItem("spec")!));
      expect(assetSavedSpec.authoring.walkingSprites.player.type).toBe("custom");
      expect(assetSavedSpec.title).toBe("Newer manual title");
      expect(Object.keys(assetSavedSpec.authoring.portraitImages)).toEqual(firstCharacter.stances.map((s: any) => `${firstCharacter.id}:${s.id}`));
      await page.reload();
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      await playerSlot.getByText(/Saved selection/).waitFor();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload();
      await page.getByRole("tab", { name: "Assets", exact: true }).click();
      await page.locator('[id="asset-sprite-player"]').getByRole("button", { name: "Play walking preview", exact: true }).first().waitFor();
      // A recovered old base must not silently replace a newer saved adventure.
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator("#edit-title").fill("Older unsaved draft");
      await page.evaluate(() => {
        const spec = JSON.parse(localStorage.getItem("spec")!);
        spec.title = "Newer saved adventure";
        localStorage.setItem("spec", JSON.stringify(spec));
        localStorage.setItem("version", String(Number(localStorage.getItem("version")) + 1));
      });
      page.once("dialog", dialog => dialog.accept());
      await page.reload();
      await page.getByRole("alert").filter({ hasText: "saved adventure changed while you were away" }).waitFor();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download recovered draft" }).click();
      const download = await downloadPromise;
      expect(JSON.parse(await readFile((await download.path())!, "utf8")).title).toBe("Older unsaved draft");
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Discard edits", exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem("v3-editor-draft:fixture"))).toBeNull();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.locator("#edit-title").inputValue()).toBe("Newer saved adventure");
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
  90_000,
);
