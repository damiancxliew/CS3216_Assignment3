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
    mkdirSync("output/guided-226-redesign", { recursive: true });
    const browser = await chromium.launch({ headless: true, slowMo: 650 });
    const context = await browser.newContext({
      recordVideo: {
        dir: "output/guided-226-redesign",
        size: { width: 1440, height: 1000 },
      },
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const runtimeErrors: string[] = [];
    const consoleMessages: { level: string; text: string }[] = [];
    page.on("console", (message) =>
      consoleMessages.push({ level: message.type(), text: message.text() }),
    );
    let passed = false;
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    const waitTitle = async (title: string) => {
      await page
        .getByRole("heading", { name: title, exact: true, level: 2 })
        .waitFor({ timeout: 90000 });
    };
    const conversation = page.getByRole("region", {
      name: "Adventure conversation",
      exact: true,
    });
    const content = page.getByRole("region", {
      name: "Generated content",
      exact: true,
    });
    const editCard = async (name: string) =>
      content
        .getByRole("region", { name, exact: true })
        .getByRole("button", { name: "Edit", exact: true })
        .click();
    let toolbarStyle: unknown = null;
    const capture = async (pass: string) => {
      await page.waitForTimeout(1500);
      await conversation
        .getByText("How would you like to generate?", { exact: true })
        .waitFor();
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(750);
        const left = await conversation.boundingBox();
        const right = await content.boundingBox();
        expect(left).not.toBeNull();
        expect(right).not.toBeNull();
        const composer = conversation.getByRole("textbox", {
          name: "Message",
          exact: true,
        });
        expect(await composer.isVisible()).toBe(true);
        const composerBox = await composer.boundingBox();
        expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
          left!.y + left!.height,
        );

        expect(
          await page.getByText("Your conversation", { exact: true }).count(),
        ).toBe(0);
        expect(
          await conversation.evaluate(
            (element) => getComputedStyle(element).boxShadow,
          ),
        ).not.toBe("none");
        if (pass === "sources") {
          const source = content.locator("label").first();
          const checkbox = await source.getByRole("checkbox").boundingBox();
          const title = await source.locator("span").boundingBox();
          const lineHeight = await source
            .locator("span")
            .evaluate((element) =>
              parseFloat(getComputedStyle(element).lineHeight),
            );
          expect(checkbox).not.toBeNull();
          expect(title).not.toBeNull();
          expect(
            Math.abs(
              checkbox!.y + checkbox!.height / 2 - title!.y - lineHeight / 2,
            ),
          ).toBeLessThan(2);
          const link = content.locator('a[href^="https:"]').first();
          expect(
            await link.evaluate((element) => getComputedStyle(element).color),
          ).not.toBe(
            await source
              .locator("span")
              .evaluate((element) => getComputedStyle(element).color),
          );
          expect(
            await link.evaluate(
              (element) => getComputedStyle(element).textDecorationLine,
            ),
          ).toContain("underline");
        }
        const toolbar = content.locator("[data-review-toolbar]");
        if (await toolbar.count()) {
          const currentStyle = await toolbar.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              border: style.borderTopColor,
              width: style.borderTopWidth,
              radius: style.borderRadius,
              shadow: style.boxShadow,
              padding: style.paddingTop,
            };
          });
          if (toolbarStyle) expect(currentStyle).toEqual(toolbarStyle);
          else toolbarStyle = currentStyle;
          const primary = toolbar.getByRole("button", {
            name: /^(Continue generation|Save changes)$/,
          });
          expect((await primary.boundingBox())!.height).toBe(40);
        }
        if (pass === "send-tooltip") {
          const tooltip = await conversation.getByRole("tooltip").boundingBox();
          expect(tooltip).not.toBeNull();
          expect(tooltip!.x).toBeGreaterThanOrEqual(0);
          expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(width);
        }
        if (width >= 768) {
          expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
          expect(Math.abs(left!.y - right!.y)).toBeLessThan(3);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollHeight <= innerHeight + 1,
            ),
          ).toBe(true);
        } else expect(right!.y).toBeGreaterThanOrEqual(left!.y + left!.height);
        await page.screenshot({
          path: `output/guided-226-redesign/${pass}-${width}.png`,
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
    const click = async (name: string) => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(1000);
    };
    const requestChange = async (text: string) => {
      await conversation
        .getByRole("textbox", { name: "Message", exact: true })
        .fill(text);
      await conversation
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await conversation
        .getByRole("region", { name: "Suggested changes", exact: true })
        .waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
    };
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
      await editCard(
        fieldName === "What Happened" ? "Reveal and questions" : value,
      );
      expect(
        await page
          .getByRole("textbox", { name: fieldName, exact: true })
          .first()
          .inputValue(),
      ).toBe(value);
    };
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
      await click("Guided: check after every pass");
      await capture("brief");
      const sendHint = conversation.getByRole("tooltip", {
        includeHidden: true,
      });
      expect(await sendHint.textContent()).toBe(
        "You can send this when the next review is ready.",
      );
      expect(await sendHint.isVisible()).toBe(false);
      await conversation
        .getByRole("group", { name: "Send message unavailable", exact: true })
        .focus();
      await conversation.getByRole("tooltip").waitFor();
      await capture("send-tooltip");
      const originalConversation = await conversation.elementHandle();
      const composer = conversation.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await composer.fill("A message drafted before generation");
      await click("Create");
      await content
        .getByRole("region", { name: "Generation progress", exact: true })
        .waitFor();
      expect(
        await originalConversation!.evaluate((element) => element.isConnected),
      ).toBe(true);
      await waitTitle("Choose sources");
      expect(
        await originalConversation!.evaluate((element) => element.isConnected),
      ).toBe(true);
      expect(
        (await store.load(id))!.state!.messages.some(
          (message) => message.text === "How would you like to generate?",
        ),
      ).toBe(true);
      expect(
        await page
          .getByText("Local handout · Included", { exact: true })
          .count(),
      ).toBe(1);
      expect(await composer.inputValue()).toBe(
        "A message drafted before generation",
      );
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
      expect(await composer.inputValue()).toBe(
        "A message drafted before generation",
      );
      await requestChange("Exclude Optional outside result");
      expect(
        await page
          .getByRole("checkbox", { name: "Optional outside result" })
          .isChecked(),
      ).toBe(true);
      await capture("source-proposal");
      await conversation
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      expect(
        await page
          .getByRole("checkbox", { name: "Optional outside result" })
          .isChecked(),
      ).toBe(false);
      await composer.fill("A draft to carry to the outline");
      await click("Continue generation");
      await waitTitle("Story outline");
      expect(
        await conversation
          .getByText("Applied to the cards.", { exact: true })
          .count(),
      ).toBe(0);
      expect(await composer.inputValue()).toBe(
        "A draft to carry to the outline",
      );
      await capture("skeleton");
      expect(await content.getByRole("textbox").count()).toBe(0);
      await click("Edit plan");
      const overview = content
        .getByRole("heading", { name: "Overview", exact: true })
        .locator("..")
        .locator("..");
      expect(
        await overview.evaluate(
          (element) => getComputedStyle(element).borderTopWidth,
        ),
      ).toBe("0px");
      expect(
        await overview.evaluate(
          (element) => getComputedStyle(element).paddingTop,
        ),
      ).toBe("0px");
      const editingCard = overview.locator("..");
      const planCard = content.getByRole("region", {
        name: "Adventure plan",
        exact: true,
      });
      const cardStyle = (element: Element) => {
        const style = getComputedStyle(element);
        return {
          border: style.borderTopColor,
          width: style.borderTopWidth,
          radius: style.borderRadius,
          shadow: style.boxShadow,
          padding: style.paddingTop,
        };
      };
      expect(await editingCard.evaluate(cardStyle)).toEqual(
        await planCard.evaluate(cardStyle),
      );
      await capture("skeleton-editing");
      const generatedTitle = await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .inputValue();
      await requestChange('Rename the outline to "Suggested outline title"');
      await conversation
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      expect(
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .first()
          .inputValue(),
      ).toBe("Suggested outline title");
      await page
        .getByRole("status")
        .filter({ hasText: /^Saved / })
        .waitFor();
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
      await click("Edit plan");
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
      await waitTitle("Stages and characters");
      expect(
        await content.locator("[data-review-card]").count(),
      ).toBeGreaterThan(5);
      expect(await content.getByRole("textbox").count()).toBe(0);
      await capture("details");
      const messageInput = conversation.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await messageInput.fill(
        'Rename the first stage to "Suggested stage title"',
      );
      const chatUrl = `${origin}/v3/teacher/${id}`;
      await page.route(chatUrl, (route) =>
        route.request().method() === "POST"
          ? route.abort("failed")
          : route.continue(),
      );
      await conversation
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await conversation
        .getByText(
          "Could not prepare a suggestion. Your message is still here. Try again.",
          { exact: true },
        )
        .waitFor();
      expect(await messageInput.inputValue()).toBe(
        'Rename the first stage to "Suggested stage title"',
      );
      await page.unroute(chatUrl);
      await requestChange('Rename the first stage to "Suggested stage title"');
      const beforeChatApply = await admin
        .from("adventures_v3")
        .select("pause_draft,status")
        .eq("id", id)
        .single();
      expect(beforeChatApply.data?.pause_draft).toBeNull();
      expect(beforeChatApply.data?.status).toBe("needs_review");
      await conversation
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      await content
        .getByRole("region", { name: "Suggested stage title", exact: true })
        .waitFor();
      expect(
        (
          await admin
            .from("adventures_v3")
            .select("pause_draft")
            .eq("id", id)
            .single()
        ).data?.pause_draft,
      ).toBeNull();

      await content
        .locator("[data-review-card]")
        .first()
        .getByRole("button", { name: "Edit", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      expect(
        await page.getByRole("textbox", { name: "Scene", exact: true }).count(),
      ).toBe(0);
      await requestChange('Rename the first stage to "Expired suggestion"');
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("A newer local edit");
      expect(
        await conversation
          .getByRole("region", { name: "Suggested changes", exact: true })
          .count(),
      ).toBe(0);
      await savedReload("Title", "Guided stage title", undefined, true);
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
      await content
        .getByRole("region", { name: "Guided stage title", exact: true })
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await editCard("Temenggong Abdul Rahman");
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
      await click("Resolve issues");
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
      await waitTitle("Decisions and endings");
      await content
        .getByRole("heading", { name: "Endings produced", exact: true })
        .first()
        .waitFor();
      await capture("endings");
      await requestChange(
        'Rename the alternative ending to "Unused suggested ending"',
      );
      await conversation
        .getByRole("button", { name: "Keep my edits", exact: true })
        .click();
      expect(
        await content
          .getByRole("region", { name: "Waiting for Calcutta", exact: true })
          .count(),
      ).toBe(1);

      const historical = content
        .locator("[data-review-card]")
        .filter({ hasText: "Historical ending" });
      await historical
        .getByRole("button", { name: "Edit", exact: true })
        .click();
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
      await click("Resolve issues");
      await click("Apply suggested fix");
      await historical
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await editCard("Waiting for Calcutta");
      await savedReload("Title", "Guided ending title", "Endings");
      await click("Continue generation");
      await waitTitle("Reveal and questions");
      await capture("reveal");
      await requestChange(
        'Rewrite the reveal as "A suggested reveal explanation"',
      );
      await conversation
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      await editCard("Reveal and questions");
      // Pick a prose field from reveal and retain its identity across reload.
      await savedReload("What Happened", "A teacher's reveal question?");
      await click("Continue generation");
      await page
        .getByRole("heading", { name: "Your adventure is ready", exact: true })
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
      await requestChange(
        'Rename the first stage to "A title changed after generation"',
      );
      await conversation
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      expect(
        (await admin.from("adventures_v3").select("spec").eq("id", id).single())
          .data?.spec.stages[0].title,
      ).toBe("Guided stage title");
      await click("Save changes");
      await page.getByText("Changes saved.", { exact: true }).waitFor();
      await page.reload();
      await page
        .getByRole("heading", { name: "Your adventure is ready", exact: true })
        .waitFor();
      expect(
        (await admin.from("adventures_v3").select("spec").eq("id", id).single())
          .data?.spec.stages[0].title,
      ).toBe("A title changed after generation");
      expect(
        await conversation
          .getByText(
            'Rename the first stage to "A title changed after generation"',
            { exact: true },
          )
          .count(),
      ).toBe(1);
      const savedAdventure = content.getByRole("region", {
        name: "Saved adventure",
        exact: true,
      });
      const savedStages = savedAdventure
        .locator("summary")
        .filter({ hasText: "Stages, characters and documents" });
      await savedStages.click();
      const savedCharacter = savedAdventure.getByRole("region", {
        name: "Temenggong Abdul Rahman",
        exact: true,
      });
      await savedCharacter
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      const trustNotice = savedCharacter.getByRole("textbox", {
        name: "Trust Notice",
        exact: true,
      });
      const savedNotice = await trustNotice.inputValue();
      await trustNotice.fill("");
      expect(
        await savedAdventure
          .getByRole("button", { name: "Save changes", exact: true })
          .isDisabled(),
      ).toBe(true);
      await click("Resolve issues");
      await click("Apply suggested fix");
      expect(await trustNotice.inputValue()).toBe(savedNotice);
      await savedCharacter
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await savedStages.click();
      await capture("ready");
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
      await waitTitle("Building your adventure");
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
      await waitTitle("Choose sources");
      await page
        .getByText("Outside source policy", {
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
        path: "output/guided-226-redesign/failure.png",
        fullPage: true,
      });
      console.log((await page.locator("main").innerText()).slice(0, 7000));
      throw error;
    } finally {
      await context.close();
      if (passed)
        copyFileSync(
          await page.video()!.path(),
          "output/guided-226-redesign/walkthrough.webm",
        );
      writeFileSync(
        "output/guided-226-redesign/runtime-console.json",
        JSON.stringify({ runtimeErrors, consoleMessages }, null, 2),
      );
      await browser.close();
      // Preserve the disposable adventure and recording for review; no seeded records are modified.
    }
  },
  360000,
);
