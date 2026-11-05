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
    page.on("response", async (response) => {
      if (response.status() >= 400)
        console.log(
          "Browser HTTP failure",
          response.status(),
          response.url(),
          (await response.text().catch(() => "")).slice(0, 500),
        );
    });
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
      for (const width of process.env.GUIDED_TEST_DESKTOP_ONLY === "1"
        ? [1440]
        : [320, 768, 1024, 1440]) {
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
        if (
          ["skeleton", "details", "endings", "reveal", "ready"].includes(pass)
        ) {
          const toolbar = content.locator("[data-review-toolbar]");
          await toolbar.waitFor();
          const toolbarBox = await toolbar.boundingBox();
          if (width === 1440) {
            expect(toolbarBox!.height).toBeLessThan(75);
            const buttonTops = await toolbar
              .locator("button")
              .evaluateAll((buttons) =>
                buttons
                  .map((button) => button.getBoundingClientRect())
                  .filter((box) => box.width > 0)
                  .map((box) => box.top),
              );
            expect(
              Math.max(...buttonTops) - Math.min(...buttonTops),
            ).toBeLessThan(2);
          }
          expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(1000);
          expect(toolbarBox!.y + toolbarBox!.height).toBeGreaterThan(950);
          expect(
            await toolbar
              .getByRole("button", { name: "Resolve issues", exact: true })
              .count(),
          ).toBe(1);
          const scrollTop = await content
            .locator("[data-generated-content]")
            .evaluate((element) => {
              const before = element.scrollTop;
              element.scrollTop = element.scrollHeight;
              return before;
            });
          expect((await toolbar.boundingBox())!.y).toBe(toolbarBox!.y);
          await content
            .locator("[data-generated-content]")
            .evaluate((element, top) => {
              element.scrollTop = top;
            }, scrollTop);
          const status = conversation
            .getByRole("status")
            .filter({
              hasText:
                /Choose which|Read through|The scenes|The endings|Preview the/,
            })
            .first();
          if (await status.count()) {
            expect(
              await status.evaluate(
                (element) => getComputedStyle(element).textAlign,
              ),
            ).toBe("center");
            expect(
              await status.evaluate(
                (element) => getComputedStyle(element).boxShadow,
              ),
            ).toBe("none");
          }
        }
        const composerBox = await composer.boundingBox();
        const sendBox = await conversation
          .getByRole("button", {
            name: "Send message",
            exact: true,
          })
          .boundingBox();
        expect(sendBox).not.toBeNull();
        expect(
          Math.abs(
            sendBox!.y +
              sendBox!.height / 2 -
              (composerBox!.y + composerBox!.height / 2),
          ),
        ).toBeLessThan(1);
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
            name: /^(Create adventure|Continue generation|Save changes)$/,
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
          expect(Math.abs(left!.y - right!.y)).toBeLessThan(1);
          if (pass === "brief") {
            const briefCard = await content
              .getByRole("heading", {
                name: "The brief",
                exact: true,
              })
              .locator("..")
              .boundingBox();
            expect(Math.abs(left!.y - briefCard!.y)).toBeLessThan(1);
          }
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
    // Every stage's Continue opens a confirmation dialog.
    const continueGeneration = async () => {
      await click("Continue generation");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Continue", exact: true })
        .click();
    };
    const saveStatus = content
      .locator("[data-review-toolbar]")
      .getByRole("status")
      .filter({ hasText: /^(Saving…|Couldn’t save|Couldn't save — retrying)$/ });
    /** Autosave shows a status during its 1 s debounce and clears it once saved. */
    const waitAutosaved = async () => {
      await saveStatus.first().waitFor();
      await saveStatus.first().waitFor({ state: "detached" });
    };
    const storedEdits = async () =>
      JSON.stringify(
        (
          await admin
            .from("adventures_v3")
            .select("pause_draft")
            .eq("id", id)
            .single()
        ).data?.pause_draft?.edits ?? [],
      );
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
      const field = page
        .getByRole("textbox", { name: fieldName, exact: true })
        .first();
      if (simulateFailure) {
        const url = `${origin}/v3/teacher/${id}`;
        await page.route(url, (route) =>
          route.request().method() === "POST"
            ? route.abort("failed")
            : route.continue(),
        );
        await field.fill(value);
        await saveStatus.filter({ hasText: "Couldn’t save" }).waitFor();
        expect(await field.inputValue()).toBe(value);
        await page.unroute(url);
        // A fresh edit schedules the autosave again.
        await field.fill(`${value} `);
      }
      await field.fill(value);
      await expect
        .poll(storedEdits, { timeout: 15000, interval: 500 })
        .toContain(JSON.stringify(value).slice(1, -1));
      await saveStatus.first().waitFor({ state: "detached" });
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
      await click("Create adventure");
      await content
        .getByRole("region", { name: "Generation progress", exact: true })
        .waitFor();
      expect(
        await originalConversation!.evaluate((element) => element.isConnected),
      ).toBe(true);
      await waitTitle("Sources");
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
          .getByText("Your upload is always included.", { exact: true })
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
      await continueGeneration();
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
      await waitAutosaved();
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
      await saveStatus.first().waitFor({ state: "detached" });
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
      await waitAutosaved();
      await page.reload();
      await click("Edit plan");
      expect(
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .first()
          .inputValue(),
      ).toBe("Guided skeleton title");
      await continueGeneration();
      await waitTitle("Stages, characters and documents");
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
      // Applied suggestions are edits, so they autosave like any other.
      await expect
        .poll(storedEdits, { timeout: 15000, interval: 500 })
        .toContain("Suggested stage title");

      await content
        .locator('[data-generation-section="details"] [data-review-card]')
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
      // Discard removes every edit at this step and restores the generated scenes.
      const stageTitle = page
        .getByRole("textbox", { name: "Title", exact: true })
        .first();
      await stageTitle.fill("Discard me");
      await click("Discard my edits");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Discard edits", exact: true })
        .click();
      await expect
        .poll(() => stageTitle.inputValue())
        .not.toMatch(/^(Discard me|Guided stage title)$/);
      await expect
        .poll(storedEdits, { timeout: 15000, interval: 500 })
        .toBe("[]");
      // Re-apply the stage title the final spec keeps.
      await stageTitle.fill("Guided stage title");
      await expect
        .poll(storedEdits, { timeout: 15000, interval: 500 })
        .toContain("Guided stage title");
      await content
        .getByRole("region", { name: "Guided stage title", exact: true })
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await editCard("Temenggong Abdul Rahman");
      await page
        .getByRole("textbox", { name: "Trust Notice", exact: true })
        .fill("");
      // Edits autosave; there is no Save button at a Guided pause.
      expect(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
      ).toBe(0);
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
      await continueGeneration();
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
      // A historical ending's supporting evidence is checked authoritatively when it autosaves.
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Unsupported historical edit");
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
      await continueGeneration();
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
      await continueGeneration();
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
      // Draft sections are always expanded; no summaries to open.
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
        await content
          .locator("[data-review-toolbar]")
          .getByRole("button", { name: "Save changes", exact: true })
          .isDisabled(),
      ).toBe(true);
      await click("Resolve issues");
      await click("Apply suggested fix");
      expect(await trustNotice.inputValue()).toBe(savedNotice);
      await savedCharacter
        .getByRole("button", { name: "Done", exact: true })
        .click();
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
      // While the sources pass runs, the header names the section being written.
      await waitTitle("Sources");
      await content.locator("[data-generation-placeholder]").waitFor();
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
      await waitTitle("Sources");
      await page
        .locator("summary")
        .filter({ hasText: "Couldn’t import 1 sources" })
        .click();
      // Unknown failure reasons are shown in teacher wording.
      await page
        .getByText("The source could not be imported.", {
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
