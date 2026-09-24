import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";
import tailwind from "@tailwindcss/postcss";
import { expect, it } from "vitest";

it.runIf(process.env.RUN_SELECT_BROWSER_TESTS === "1")("supports themed dropdowns, keyboard selection, form values, resets, and touch", async () => {
  const root = resolve("apps/web");
  const vite = await createServer({
    configFile: false,
    root,
    server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(".")] } },
    esbuild: { jsx: "automatic" },
    optimizeDeps: { include: ["react", "react-dom/client", "lucide-react", "@radix-ui/react-select"] },
    css: { postcss: { plugins: [tailwind()] } },
    resolve: { alias: { "@": resolve(root, "src") } },
    plugins: [{
      name: "select-test-harness",
      resolveId(id) {
        if (id === "virtual:select-test") return `\0${id}`;
      },
      async load(id) {
        if (id !== "\0virtual:select-test") return;
        return (await transformWithEsbuild(`
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { Select } from '/src/components/select.tsx';
          import { ThemeProvider, ThemeSelect } from '/src/components/theme-provider.tsx';
          import '/src/app/globals.css';
          function App() {
            const [submitted, setSubmitted] = useState('');
            return <ThemeProvider><main style={{padding: 24, maxWidth: 480}}>
              <ThemeSelect />
              <form style={{marginTop: 24}} onSubmit={event => {
                event.preventDefault();
                setSubmitted(new FormData(event.currentTarget).get('level'));
              }}>
                <label>Reading level<Select name="level" label="Reading level" defaultValue="standard"
                  options={[
                    {value:'simple', label:'Simple'},
                    {value:'standard', label:'Standard'},
                    {value:'advanced', label:'Advanced'},
                  ]} /></label>
                <button type="submit">Save</button>
                <button type="reset" style={{marginLeft: 24}}>Reset</button>
                <output aria-label="Submitted level">{submitted}</output>
              </form>
              <div style={{marginTop: 24, height: 48, overflow: 'hidden'}}>
                <Select label="Long list" options={Array.from({length: 40}, (_, i) => ({value: String(i), label: 'Option ' + i}))} />
              </div>
            </main></ThemeProvider>;
          }
          createRoot(document.getElementById('root')).render(<App />);
        `, "select-test.tsx", { loader: "tsx", jsx: "automatic" })).code;
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<html style="--font-ui: Arial; --font-record: Georgia"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/__x00__virtual:select-test"></script></body></html>');
        });
      },
    }],
  });
  await vite.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(vite.resolvedUrls!.local[0]!);
    const theme = page.getByRole("combobox", { name: "Color theme" });
    await theme.click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    expect(await theme.innerText()).toBe("Dark");
    await theme.click();
    await mkdir(resolve("output/select"), { recursive: true });
    await page.screenshot({ path: resolve("output/select/dark.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    expect(await theme.evaluate((element) => element === document.activeElement)).toBe(true);

    const field = page.getByRole("combobox", { name: "Reading level" });
    await field.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.activeElement?.textContent === "Advanced");
    await page.keyboard.press("Enter");
    expect(await field.innerText()).toBe("Advanced");
    await page.getByRole("button", { name: "Save" }).click();
    expect(await page.getByLabel("Submitted level").innerText()).toBe("advanced");
    await page.getByRole("button", { name: "Reset" }).click();
    expect(await field.innerText()).toBe("Standard");
    await page.getByRole("button", { name: "Save" }).click();
    expect(await page.getByLabel("Submitted level").innerText()).toBe("standard");
    await field.click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
    await page.keyboard.press("s");
    await page.waitForFunction(() => document.activeElement?.textContent === "Simple");
    await page.keyboard.press("Enter");
    expect(await field.innerText()).toBe("Simple");
    await field.click();
    await page.mouse.click(900, 700);
    expect(await page.getByRole("listbox").count()).toBe(0);

    await theme.click();
    await page.getByRole("option", { name: "Light", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await theme.click();
    await page.screenshot({ path: resolve("output/select/light.png"), animations: "disabled" });
    await page.keyboard.press("Escape");

    const mobile = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    await mobile.goto(vite.resolvedUrls!.local[0]!);
    await mobile.getByRole("combobox", { name: "Color theme" }).tap();
    await mobile.getByRole("option", { name: "Dark", exact: true }).tap();
    expect(await mobile.getByRole("combobox", { name: "Color theme" }).innerText()).toBe("Dark");
    await mobile.getByRole("combobox", { name: "Long list" }).tap();
    const menu = mobile.getByRole("listbox");
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
    await mobile.getByRole("option", { name: "Option 39", exact: true }).scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: resolve("output/select/mobile.png"), animations: "disabled" });
    await mobile.getByRole("option", { name: "Option 39", exact: true }).tap();
    expect(await mobile.getByRole("combobox", { name: "Long list" }).innerText()).toBe("Option 39");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await vite.close();
  }
}, 60_000);
