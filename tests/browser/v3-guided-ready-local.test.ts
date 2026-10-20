import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import {
  serviceClient,
  createUserClient,
  addMember,
  uniqueEmail,
  TESTING_SCHOOL_ID,
} from "../db/helpers";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";

it.runIf(process.env.RUN_GUIDED_LOCAL_TESTS === "1")(
  "shows existing issues separately from new errors in a saved Guided draft",
  async () => {
    const origin = process.env.GUIDED_TEST_ORIGIN ?? "http://127.0.0.1:3226";
    const admin = serviceClient();
    const email = uniqueEmail("guided-ready-226");
    const teacher = await createUserClient(email);
    await addMember(TESTING_SCHOOL_ID, teacher.userId, "teacher");
    const store = supabaseV3BriefStore(admin);
    const id = await store.create({
      schoolId: TESTING_SCHOOL_ID,
      ownerId: teacher.userId,
    });
    const state = (await store.load(id))!.state!;
    state.draft.mode = "guided";
    state.draft.episode = "Singapore in 1819";
    const spec = AdventureSpec.parse(
      JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
    );
    // Omitted source snapshots intentionally leave existing source-verification issues.
    const updated = await admin
      .from("adventures_v3")
      .update({ status: "draft", spec, brief_state: state })
      .eq("id", id);
    if (updated.error) throw updated.error;
    const output = "output/guided-226-redesign";
    mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, slowMo: 650 });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      recordVideo: { dir: output, size: { width: 1440, height: 1000 } },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let passed = false;
    try {
      await page.goto(`${origin}/teacher`);
      await page.waitForTimeout(2000);
      const login = page.locator("main:visible");
      await login
        .locator("summary:visible")
        .filter({ hasText: "Local dev sign-in (email/password)" })
        .click();
      await login.locator('input[name="email"]:visible').fill(email);
      await login
        .locator('input[name="password"]:visible')
        .fill("password123!");
      await login
        .getByRole("button", { name: "Sign in or create account", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "Choose your next adventure",
          exact: true,
        })
        .waitFor();
      await page.goto(`${origin}/v3/teacher/${id}`);
      await page
        .getByRole("heading", { name: "Your adventure is ready", exact: true })
        .waitFor();
      const saved = page.getByRole("region", {
        name: "Saved adventure",
        exact: true,
      });
      const issues = saved
        .locator("summary")
        .filter({ hasText: /^Existing generation issues \([1-9]\d*\)$/ });
      await issues.waitFor();
      await issues.focus();
      await page.keyboard.press("Enter");
      expect(await issues.locator("..").getAttribute("open")).not.toBeNull();
      for (const width of process.env.GUIDED_TEST_DESKTOP_ONLY === "1"
        ? [1440]
        : [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(1000);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `${output}/ready-issues-${width}.png`,
          fullPage: true,
          caret: "initial",
        });
      }
      await issues.click();
      await saved
        .locator("summary")
        .filter({ hasText: "Stages, characters and documents" })
        .click();
      await saved
        .getByRole("button", { name: "Edit", exact: true })
        .first()
        .click();
      await saved
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("A harmless title edit");
      expect(
        await page
          .locator("[data-review-toolbar]")
          .getByRole("button", { name: "Save changes", exact: true })
          .isEnabled(),
      ).toBe(true);
      expect(errors).toEqual([]);
      passed = true;
    } finally {
      await context.close();
      if (passed)
        copyFileSync(await page.video()!.path(), `${output}/ready-issues.webm`);
      await browser.close();
    }
  },
  90000,
);
