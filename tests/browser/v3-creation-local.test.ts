import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { extractText, getDocumentProxy } from "unpdf";
import { expect, it } from "vitest";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import {
  addMember, createUserClient, serviceClient, uniqueEmail,
  SUPABASE_URL, TESTING_SCHOOL_ID,
} from "../db/helpers";

// Requires the real local Next/Supabase stack; never resets or seeds the DB.
// No brief turns or generation requests are made, so this needs no model call.
it.runIf(process.env.RUN_CREATION_LOCAL_TESTS === "1")(
  "uploads real sources, persists source keys and previews them after reload at desktop sizes",
  async () => {
    const origin = process.env.CREATION_LOCAL_ORIGIN ?? "http://127.0.0.1:3237";
    for (const url of [origin, SUPABASE_URL]) {
      if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw Error("Local Next and Supabase endpoints are required");
    }
    const output = resolve("output/v3-creation-local-check");
    await mkdir(output, { recursive: true });
    const pdfPath = resolve("packages/generation/fixtures/eval-corpus/magna-carta-1297-translation.pdf");
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(pdfPath)));
    const pdfText = await extractText(pdf, { mergePages: true });
    expect(pdfText.text.replace(/\s/g, "").length).toBeGreaterThan(200);
    const pdfMarker = pdfText.text.match(/[A-Za-z]{6,}/)?.[0];
    expect(pdfMarker).toBeTruthy();

    const admin = serviceClient();
    const school = await admin.from("organization").select("id").eq("id", TESTING_SCHOOL_ID).single();
    if (school.error) throw Error("The existing local testing school is required; no database reset is performed");
    const email = uniqueEmail("creation-local");
    const teacher = await createUserClient(email);
    let id: string | undefined;
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const runtimeErrors: string[] = [];
    const httpFailures: { status: number; path: string }[] = [];
    page.on("pageerror", error => runtimeErrors.push(error.message));
    page.on("response", response => {
      if (response.status() >= 400) httpFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    });
    const measurements: unknown[] = [];
    const txt = { name: "Local harbour notes.txt", mimeType: "text/plain", buffer: Buffer.from("LOCAL_TEXT_MARKER: Merchants used the harbour to exchange goods, and local residents negotiated access to the settlement.") };
    const md = { name: "Local civilian accounts.md", mimeType: "text/markdown", buffer: Buffer.from("LOCAL_MARKDOWN_MARKER: Families described daily life near the harbour. Their accounts show different views of the settlement.") };
    const sourceLibrary = page.getByRole("region", { name: "Source material", exact: true });
    const readDocuments = async () => {
      const result = await admin.from("sources_v3").select("source_key,title,kind,pages").eq("adventure_id", id!);
      if (result.error) throw result.error;
      return result.data;
    };
    const readBrief = async () => {
      const row = await supabaseV3BriefStore(admin).load(id!);
      expect(row?.status).toBe("briefing");
      return row!.state!;
    };
    try {
      await addMember(TESTING_SCHOOL_ID, teacher.userId, "teacher");
      id = await supabaseV3BriefStore(admin).create({ schoolId: TESTING_SCHOOL_ID, ownerId: teacher.userId });
      await page.goto(`${origin}/teacher`);
      await page.locator("main summary:visible").filter({ hasText: "Local dev sign-in (email/password)" }).click();
      await page.locator('main input[name="email"]:visible').fill(email);
      await page.locator('main input[name="password"]:visible').fill("password123!");
      await page.getByRole("button", { name: "Sign in or create account", exact: true }).click();
      await page.getByRole("heading", { name: "Choose your next adventure", exact: true }).waitFor();
      // The legacy entry URL now opens the workspace without a Start screen.
      await page.goto(`${origin}/v3/teacher/new`);
      await page.waitForURL(`${origin}/v3/teacher/${id}`);
      await sourceLibrary.waitFor();
      expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe(0);
      // Revisiting before adding material reuses the same untouched brief.
      await page.goto(`${origin}/v3/teacher/new`);
      await page.waitForURL(`${origin}/v3/teacher/${id}`);
      await sourceLibrary.waitFor();
      const ownerBriefs = await admin.from("adventures_v3").select("id").eq("owner_id", teacher.userId);
      if (ownerBriefs.error) throw ownerBriefs.error;
      expect(ownerBriefs.data.map(row => row.id)).toEqual([id]);
      await page.getByLabel("Choose source files", { exact: true }).setInputFiles([txt, md]);
      await sourceLibrary.getByRole("button", { name: `Preview ${txt.name}`, exact: true }).waitFor();
      await sourceLibrary.getByRole("button", { name: `Preview ${md.name}`, exact: true }).waitFor();
      await expect.poll(async () => (await readDocuments()).length).toBe(2);
      await page.getByLabel("Choose source files", { exact: true }).setInputFiles(pdfPath);
      await sourceLibrary.getByRole("button", { name: "Preview magna-carta-1297-translation.pdf", exact: true }).waitFor();
      await expect.poll(async () => (await readDocuments()).length).toBe(3);

      // A real browser FileList from the right-hand drop surface uses the same queue.
      const transfer = await page.evaluateHandle(() => {
        const files = new DataTransfer();
        files.items.add(new File(["LOCAL_DROP_ONE_MARKER: A source selected from the right-hand drop surface."], "Dropped account.txt", { type: "text/plain" }));
        files.items.add(new File(["LOCAL_DROP_TWO_MARKER: A second independent source in the same drop batch."], "Dropped notes.md", { type: "text/markdown" }));
        return files;
      });
      await sourceLibrary.dispatchEvent("drop", { dataTransfer: transfer });
      await transfer.dispose();
      await sourceLibrary.getByRole("button", { name: "Preview Dropped account.txt", exact: true }).waitFor();
      await sourceLibrary.getByRole("button", { name: "Preview Dropped notes.md", exact: true }).waitFor();
      await expect.poll(async () => (await readDocuments()).length).toBe(5);
      const documents = await readDocuments();
      const brief = await readBrief();
      expect(brief.sources).toHaveLength(5);
      expect(new Set(documents.map(doc => doc.source_key)).size).toBe(5);
      expect(documents.every(doc => /^upload-[0-9a-f-]{36}$/.test(doc.source_key))).toBe(true);
      expect(brief.sources.map(source => source.id).sort()).toEqual(documents.map(doc => doc.source_key).sort());
      expect(documents.find(doc => doc.title === txt.name)?.pages[0].text).toContain("LOCAL_TEXT_MARKER");
      expect(documents.find(doc => doc.title.endsWith(".pdf"))?.kind).toBe("pdf");
      expect(documents.find(doc => doc.title.endsWith(".pdf"))?.pages.map((entry: { text: string }) => entry.text).join(" ")).toContain(pdfMarker);

      await page.reload();
      await sourceLibrary.getByRole("button", { name: `Preview ${txt.name}`, exact: true }).waitFor();
      expect((await readBrief()).sources.map(source => source.id)).toEqual(brief.sources.map(source => source.id));
      const previewButton = sourceLibrary.getByRole("button", { name: `Preview ${txt.name}`, exact: true });
      for (const width of [1280, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await page.evaluate(() => {
          const left = document.querySelector('[aria-label="Adventure conversation"]')!.getBoundingClientRect();
          const right = document.querySelector('[aria-label="Generated content"]')!.getBoundingClientRect();
          return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, leftRight: left.right, rightLeft: right.left };
        });
        expect(layout.documentWidth).toBeLessThanOrEqual(width);
        expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
        expect(layout.leftRight).toBeLessThanOrEqual(layout.rightLeft);
        measurements.push(layout);
        await previewButton.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await dialog.getByText(/LOCAL_TEXT_MARKER/).waitFor();
        expect(await dialog.innerText()).toContain("Original document layout is not shown");
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        // Native dialogs can tab to browser chrome (body becomes active),
        // but background page controls must stay out of the tab sequence.
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate(element => document.activeElement === document.body || element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Shift+Tab");
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
        await page.screenshot({ path: resolve(output, `text-preview-${width}.png`) });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        expect(await previewButton.evaluate(button => document.activeElement === button)).toBe(true);
        await page.screenshot({ path: resolve(output, `uploaded-${width}.png`) });
      }
      await sourceLibrary.getByRole("button", { name: "Preview magna-carta-1297-translation.pdf", exact: true }).click();
      await page.getByRole("dialog").getByText(pdfMarker!, { exact: false }).waitFor();
      await page.getByRole("dialog").getByText(/Extracted page/).waitFor();
      await page.screenshot({ path: resolve(output, "pdf-preview-1440.png") });
      await page.keyboard.press("Escape");
      expect(runtimeErrors).toEqual([]);
      expect(httpFailures).toEqual([]);
      await writeFile(resolve(output, "results.json"), JSON.stringify({ measurements, sourceCount: documents.length, kinds: documents.map(doc => doc.kind), stableSourceKeysAfterReload: true, automaticNewEntry: true, repeatedEntryReusesUntouchedBrief: true, runtimeErrors, httpFailures }, null, 2));
    } catch (error) {
      await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
      if (id) {
        const removed = await admin.from("adventures_v3").delete().eq("id", id);
        if (removed.error) throw removed.error;
      }
      const membership = await admin.from("organization_member").delete().eq("user_id", teacher.userId).eq("organization_id", TESTING_SCHOOL_ID);
      if (membership.error) throw membership.error;
      const removedUser = await admin.auth.admin.deleteUser(teacher.userId);
      if (removedUser.error) throw removedUser.error;
    }
  },
  240000,
);
