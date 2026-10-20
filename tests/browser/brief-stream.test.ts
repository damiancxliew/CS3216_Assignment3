import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import { expect, it } from "vitest";

// Hold the actual HTTP response open so optimistic rendering and streaming are
// checked independently of model latency, credentials, and database fixtures.
it.runIf(process.env.RUN_BRIEF_BROWSER_TESTS === "1")("renders sent bubbles and partial replies before completion in both brief chats", async () => {
  const root = resolve("apps/web");
  const initial = {
    adventureId: "00000000-0000-0000-0000-000000000001",
    draft: { sources: { summary: "A source", episodeProposal: "A historical episode", title: "A title", setting: "A place", studentRole: "A clerk" } },
    messages: [{ role: "assistant", text: "Tell me your choice", slot: "episode" }],
    sources: [],
  };
  let response: import("node:http").ServerResponse | undefined;
  let payload: { input: { text: string } } | undefined;
  let requests = 0;
  const errors: string[] = [];
  const vite = await createServer({
    configFile: false, root, publicDir: false,
    define: { "process.env": "{}" },
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" },
    css: { postcss: { plugins: [] } },
    optimizeDeps: { include: ["react", "react-dom/client", "lucide-react"] },
    resolve: { alias: { "@": resolve(root, "src") } },
    plugins: [{
      name: "brief-stream-test", enforce: "pre",
      resolveId(id) {
        if (id === "next/link") return "\0link";
        if (id === "next/navigation") return "\0navigation";
        if (id === "virtual:brief-test") return "\0brief-test";
        if (id === "../actions" || id === "./actions") return "\0actions";
      },
      async load(id) {
        if (id === "\0link") return "import React from 'react'; export default function Link(p) { return React.createElement('a', p); }";
        if (id === "\0navigation") return "export const useRouter = () => ({ refresh() {}, push() {} }); export const usePathname = () => '/teacher'; export const useSearchParams = () => new URLSearchParams();";
        if (id === "\0actions") return ["addV3BriefSource", "createFromV3Brief", "discardV3Brief", "addBriefSource", "discardBrief", "finishBrief", "startBrief"].map((name) => `export const ${name} = async () => ({error:'Unexpected action'});`).join("\n");
        if (id === "\0brief-test") return (await transformWithEsbuild(`
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { V3BriefChat } from '/src/app/v3/teacher/[id]/brief-chat.tsx';
          import { BriefChat } from '/src/app/teacher/brief-chat.tsx';
          const initial = ${JSON.stringify(initial)};
          createRoot(document.getElementById('root')).render(location.search === '?v2' ? <BriefChat resume={initial} /> : <V3BriefChat initial={initial} />);
        `, "brief-test.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith("/api/")) {
            let body = "";
            for await (const chunk of req) body += chunk;
            payload = JSON.parse(body);
            requests++;
            response = res;
            res.writeHead(200, { "Content-Type": "application/x-ndjson" });
            res.write('{"type":"start"}\n');
            return;
          }
          if (req.url?.split("?")[0] !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<html><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/__x00__brief-test"></script></body></html>');
        });
      },
    }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await vite.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const origin = vite.resolvedUrls!.local[0]!;
    for (const version of ["v3", "v2"]) {
      await page.goto(origin + (version === "v2" ? "?v2" : ""));
      if (version === "v2") await page.getByRole("button", { name: "Continue", exact: true }).click();
      const composer = page.locator("textarea");
      try {
        await composer.fill("My historical episode", { timeout: 10_000 });
      } catch (error) {
        throw new Error(JSON.stringify({ errors, html: await page.locator("body").innerHTML() }) + String(error));
      }
      await composer.press("Enter");
      await page.getByText("My historical episode", { exact: true }).waitFor();
      expect(await composer.inputValue()).toBe("");
      expect(await composer.isDisabled()).toBe(true);
      await expect.poll(() => requests).toBe(version === "v3" ? 1 : 3);
      expect(payload?.input.text).toBe("My historical episode");
      response!.write('{"type":"reply","index":0,"text":"Here is the partial reply"}\n');
      await page.getByText("Here is the partial reply", { exact: true }).waitFor();
      expect(await composer.isDisabled()).toBe(true);
      const state = { ...initial, messages: [...initial.messages,
        { role: "user", text: "My historical episode", slot: "episode" },
        { role: "assistant", text: "Here is the complete reply", slot: "episode", proposedText: "A proposal" },
      ] };
      response!.end(JSON.stringify({ type: "result", result: { ok: true, state } }) + "\n");
      await page.getByText("Here is the complete reply", { exact: true }).waitFor();
      expect(await page.getByText("My historical episode", { exact: true }).count()).toBe(1);
      expect(await page.getByText("Here is the partial reply", { exact: true }).count()).toBe(0);
      await expect.poll(() => composer.isDisabled()).toBe(false);
      // A dropped connection restores the unsent text and leaves no partial transcript.
      await composer.fill("Please retry this");
      await composer.press("Enter");
      await page.getByText("Please retry this", { exact: true }).waitFor();
      await expect.poll(() => requests).toBe(version === "v3" ? 2 : 4);
      response!.end('{"type":"reply","index":0,"text":"Interrupted text"}\n');
      await expect.poll(() => composer.inputValue()).toBe("Please retry this");
      expect(await page.getByText("Interrupted text", { exact: true }).count()).toBe(0);
      await page.getByText("The response was interrupted. Please try again.", { exact: true }).waitFor();
    }
    expect(errors).toEqual([]);
  } finally {
    response?.end();
    await browser?.close();
    await vite.close();
  }
}, 60_000);
