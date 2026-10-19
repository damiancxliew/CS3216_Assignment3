import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import {
  serviceClient,
  createUserClient,
  addMember,
  uniqueEmail,
  TESTING_SCHOOL_ID,
} from "../db/helpers";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";

it.runIf(process.env.RUN_GUIDED_LOCAL_TESTS === "1")(
  "reviews all five Guided pauses and preserves saved edits in the final spec",
  async () => {
    const origin = process.env.GUIDED_TEST_ORIGIN ?? "http://127.0.0.1:3226";
    const admin = serviceClient();
    const email = uniqueEmail("guided-226");
    const teacher = await createUserClient(email);
    await addMember(TESTING_SCHOOL_ID, teacher.userId, "teacher");
    const store = supabaseV3BriefStore(admin);
    const id = await store.create({
      schoolId: TESTING_SCHOOL_ID,
      ownerId: teacher.userId,
    });
    const state = initialBriefStateV3(id);
    state.draft = {
      sources: {
        summary: "A local handout",
        episodeProposal: "Singapore in 1819",
      },
      episode: "Singapore in 1819",
      focus: "",
      readingLevel: "sec",
      timerMinutes: null,
      sourcePolicy: { allowAny: false, extraDomains: [] },
    };
    state.sources = [
      { id: "upload-226", title: "Local handout", kind: "text" },
    ];
    state.messages = [
      {
        role: "assistant",
        text: "How would you like to generate?",
        slot: "mode",
      },
    ];
    await store.save(id, state);
    await supabaseV3SourceStore(() => admin).saveUploads(id, [
      {
        storageKey: "local-guided-226",
        doc: {
          id: "upload-226",
          title: "Local handout",
          kind: "text",
          pages: [
            {
              page: 1,
              text: "Singapore was established as a trading settlement in 1819.",
            },
          ],
          pageCount: 1,
          charCount: 60,
          contentHash: "guided-226",
          warnings: [],
        },
      },
    ]);
    mkdirSync("output/guided-226", { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      recordVideo: {
        dir: "output/guided-226",
        size: { width: 1440, height: 1000 },
      },
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const runtimeErrors: string[] = [];
    const consoleMessages: { level: string; text: string }[] = [];
    page.on("console", (message) =>
      consoleMessages.push({ level: message.type(), text: message.text() }),
    );
    let passed = false;
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    const waitTitle = async (title: string) => {
      await page
        .getByRole("heading", { name: title, exact: true })
        .waitFor({ timeout: 90000 });
    };
    const capture = async (pass: string) => {
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({
          path: `output/guided-226/${pass}-${width}.png`,
          fullPage: true,
          caret: "initial",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    };
    const click = async (name: string) =>
      page.getByRole("button", { name, exact: true }).click();
    const savedReload = async (
      fieldName: string,
      value: string,
      tabAfterReload?: string,
      simulateFailure = false,
    ) => {
      await page
        .getByRole("textbox", { name: fieldName, exact: true })
        .first()
        .fill(value);
      if (simulateFailure) {
        const url = `${origin}/v3/teacher/${id}`;
        await page.route(url, (route) =>
          route.request().method() === "POST"
            ? route.abort("failed")
            : route.continue(),
        );
        await click("Save");
        await page
          .getByText(
            "Request failed. Your local edits are still here. Try again.",
            { exact: true },
          )
          .waitFor();
        expect(
          await page
            .getByRole("textbox", { name: fieldName, exact: true })
            .first()
            .inputValue(),
        ).toBe(value);
        await page.unroute(url);
      }
      await click("Save");
      await page.getByText("Edits saved.", { exact: true }).waitFor();
      const stored = await admin
        .from("adventures_v3")
        .select("pause_draft")
        .eq("id", id)
        .single();
      expect(stored.data?.pause_draft.edits.length).toBeGreaterThan(0);
      await page.reload();
      await page.getByText("Saved edits restored.", { exact: true }).waitFor();
      if (tabAfterReload)
        await page
          .getByRole("tab", { name: tabAfterReload, exact: true })
          .click();
      if (tabAfterReload === "Endings")
        await page.getByRole("button", { name: new RegExp(value) }).click();
      expect(
        await page
          .getByRole("textbox", { name: fieldName, exact: true })
          .first()
          .inputValue(),
      ).toBe(value);
    };
    try {
      await page.goto(`${origin}/teacher`);
      await page
        .getByText("Local dev sign-in (email/password)", { exact: true })
        .click();
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill("password123!");
      await click("Sign in or create account");
      await page.waitForFunction(
        () => !document.querySelector('input[name="email"]'),
      );
      await page.goto(`${origin}/v3/teacher/${id}`);
      await click("Guided: check after every pass");
      await click("Create");
      await waitTitle("Check sources");
      expect(
        await page
          .getByText("Local handout · Included", { exact: true })
          .count(),
      ).toBe(1);
      await capture("sources");
      // Exercise deselection without removing a source referenced by the fixture.
      const extra = {
        id: "outside-unused-226",
        title: "Optional outside result",
        url: "https://www.nlb.gov.sg/optional",
        origin: "outside",
        kind: "text",
        pages: [{ page: 1, text: "Optional context" }],
        pageCount: 1,
        charCount: 16,
        contentHash: "optional",
        warnings: [],
      } as const;
      await supabaseV3SourceStore(() => admin).saveOutside(
        id,
        [
          {
            id: extra.id,
            origin: "outside",
            title: extra.title,
            url: extra.url,
          },
        ],
        [{ ...extra, pages: [...extra.pages], warnings: [] }],
      );
      await page.reload();
      await page
        .getByRole("checkbox", { name: "Optional outside result" })
        .uncheck();
      await click("Continue generation");
      await waitTitle("Check the skeleton");
      await capture("skeleton");
      const generatedTitle = await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .inputValue();
      const skeletonUrl = `${origin}/v3/teacher/${id}`;
      await page.route(skeletonUrl, (route) =>
        route.request().method() === "POST"
          ? route.abort("failed")
          : route.continue(),
      );
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Discard this skeleton title");
      await page
        .getByRole("status")
        .filter({ hasText: "Couldn't save — retrying" })
        .waitFor();
      await page.unroute(skeletonUrl);
      await page
        .getByRole("status")
        .filter({ hasText: /^Saved / })
        .waitFor();
      await click("Discard my edits");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Discard edits", exact: true })
        .click();
      await page.waitForFunction(
        (title) =>
          Array.from(document.querySelectorAll("input")).some(
            (input) => input.value === title,
          ),
        generatedTitle,
      );

      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Guided skeleton title");
      await page
        .getByRole("status")
        .filter({ hasText: /^Saved / })
        .waitFor();
      await page.reload();
      expect(
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .first()
          .inputValue(),
      ).toBe("Guided skeleton title");
      await click("Continue generation");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await waitTitle("Check details");
      expect(await page.getByRole("tab").allTextContents()).toEqual([
        "Stages",
        "Characters",
        "Documents",
      ]);
      expect(
        await page.getByRole("textbox", { name: "Scene", exact: true }).count(),
      ).toBe(0);
      await page.getByRole("tab", { name: "Stages", exact: true }).focus();
      await page.keyboard.press("ArrowLeft");
      expect(
        await page
          .getByRole("tab", { name: "Documents", exact: true })
          .getAttribute("aria-selected"),
      ).toBe("true");
      await page.keyboard.press("Home");
      await savedReload("Title", "Guided stage title", undefined, true);
      await capture("details");
      // Discard returns to the saved checkpoint; Continue need not follow another Save.
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Discard me");
      page.once("dialog", (dialog) => dialog.accept());
      await click("Discard unsaved edits");
      expect(
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .first()
          .inputValue(),
      ).toBe("Guided stage title");
      await page.getByRole("tab", { name: "Characters", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Trust Notice", exact: true })
        .fill("");
      expect(
        await page
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
      ).toBe(true);
      expect(
        await page
          .getByRole("button", { name: "Continue generation", exact: true })
          .isDisabled(),
      ).toBe(true);
      await click("Fix with AI");
      await page
        .getByRole("button", { name: "Apply suggested fix", exact: true })
        .waitFor({ timeout: 30000 });
      expect(
        (
          await admin
            .from("adventures_v3")
            .select("status")
            .eq("id", id)
            .single()
        ).data?.status,
      ).toBe("needs_review");
      await click("Apply suggested fix");
      expect(
        await page
          .getByRole("textbox", { name: "Trust Notice", exact: true })
          .inputValue(),
      ).not.toBe("");
      await page
        .getByRole("textbox", { name: "Voice", exact: true })
        .fill("A teacher's unsaved voice edit");
      await click("Continue generation");
      await waitTitle("Check endings");
      expect(await page.getByRole("tab").allTextContents()).toEqual([
        "Stages",
        "Endings",
      ]);
      await page
        .getByRole("heading", { name: "Endings produced", exact: true })
        .first()
        .waitFor();
      await capture("endings");
      await page.getByRole("tab", { name: "Endings", exact: true }).click();
      // A historical ending's supporting evidence is checked authoritatively on Save.
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Unsupported historical edit");
      await click("Save");
      await page
        .getByText(
          "The historical ending needs a supporting quotation from a source.",
          { exact: true },
        )
        .waitFor();
      expect(
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .first()
          .inputValue(),
      ).toBe("Unsupported historical edit");
      await click("Fix with AI");
      await click("Apply suggested fix");
      await page.getByRole("button", { name: /Waiting for Calcutta/ }).click();
      await savedReload("Title", "Guided ending title", "Endings");
      await click("Continue generation");
      await waitTitle("Check reveal");
      expect(await page.getByRole("tab").allTextContents()).toEqual([
        "Reveal and questions",
      ]);
      await capture("reveal");
      // Pick a prose field from reveal and retain its identity across reload.
      await savedReload("What Happened", "A teacher's reveal question?");
      await click("Continue generation");
      await page
        .getByText("Adventure draft", { exact: false })
        .first()
        .waitFor({ timeout: 90000 });
      const final = await admin
        .from("adventures_v3")
        .select("spec,status,pause_draft")
        .eq("id", id)
        .single();
      expect(final.data?.status).toBe("draft");
      expect(final.data?.pause_draft).toBeNull();
      expect(final.data?.spec.title).toBe("Guided skeleton title");
      expect(final.data?.spec.stages[0].title).toBe("Guided stage title");
      expect(final.data?.spec.endings[1].title).toBe("Guided ending title");
      expect(final.data?.spec.characters[0].persona.voice).toBe(
        "A teacher's unsaved voice edit",
      );
      expect(JSON.stringify(final.data?.spec.reveal)).toContain(
        "A teacher's reveal question?",
      );
      // A status transition can arrive before the job's output is committed.
      const waitingId = await store.create({
        schoolId: TESTING_SCHOOL_ID,
        ownerId: teacher.userId,
      });
      const waiting = await admin
        .from("adventures_v3")
        .update({ status: "needs_review" })
        .eq("id", waitingId);
      if (waiting.error) throw waiting.error;
      const step = await admin.from("job_steps").insert({
        job_id: waitingId,
        name: "sources",
        step: "v3.gen.sources",
        status: "running",
        input: {
          adventureId: waitingId,
          schoolId: TESTING_SCHOOL_ID,
          ownerId: teacher.userId,
          episode: "Singapore",
          readingLevel: "sec",
          mode: "guided",
        },
      });
      if (step.error) throw step.error;
      await supabaseV3SourceStore(() => admin).saveOutside(
        waitingId,
        [
          {
            id: extra.id,
            origin: "outside",
            title: extra.title,
            url: extra.url,
          },
        ],
        [{ ...extra, pages: [...extra.pages], warnings: [] }],
      );
      await page.goto(`${origin}/v3/teacher/${waitingId}`);
      await waitTitle("Loading your review");
      await admin
        .from("job_steps")
        .update({
          status: "succeeded",
          output: {
            rejected: [
              {
                url: "https://rejected.example",
                reason: "Outside source policy",
              },
            ],
          },
        })
        .eq("job_id", waitingId)
        .eq("name", "sources");
      await waitTitle("Check sources");
      await page
        .getByText("https://rejected.example — Outside source policy", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("checkbox", { name: extra.title, exact: true })
        .uncheck();
      expect(
        await page
          .getByRole("button", { name: "Continue generation", exact: true })
          .isDisabled(),
      ).toBe(true);
      await page
        .getByRole("alert")
        .filter({ hasText: "Keep at least one source." })
        .waitFor();
      expect(runtimeErrors).toEqual([]);
      expect(
        consoleMessages.filter(
          (message) =>
            message.level === "error" &&
            message.text !== "Failed to load resource: net::ERR_FAILED",
        ),
      ).toEqual([]);
      passed = true;
    } catch (error) {
      await page.screenshot({
        path: "output/guided-226/failure.png",
        fullPage: true,
      });
      console.log((await page.locator("main").innerText()).slice(0, 7000));
      throw error;
    } finally {
      await context.close();
      if (passed)
        copyFileSync(
          await page.video()!.path(),
          "output/guided-226/walkthrough.webm",
        );
      writeFileSync(
        "output/guided-226/runtime-console.json",
        JSON.stringify({ runtimeErrors, consoleMessages }, null, 2),
      );
      await browser.close();
      // Preserve the disposable adventure and recording for review; no seeded records are modified.
    }
  },
  360000,
);
