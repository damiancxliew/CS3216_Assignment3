import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import {
  serviceClient,
  createUserClient,
  addMember,
  uniqueEmail,
} from "../db/helpers";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { fakeOutsideSources } from "@/lib/v3/generation/fake-passes";
import { validateEditedSpec } from "@/lib/v3/edit/validation";

it.runIf(process.env.RUN_EDITOR_LOCAL_TESTS === "1")(
  "walks through fixture creation, review, edit, preview, publish and student start locally",
  async () => {
    const school = readFileSync("apps/web/.env.local", "utf8")
      .match(/^V3_SCHOOL_IDS=(.*)$/m)![1]
      .replaceAll('"', "")
      .split(",")[0];
    const admin = serviceClient();
    const schoolRow = await admin
      .from("organization")
      .select("name")
      .eq("id", school)
      .single();
    if (!/test|local/i.test(schoolRow.data?.name ?? ""))
      throw Error("Acceptance requires a test school");
    const email = uniqueEmail("editor-acceptance");
    const teacher = await createUserClient(email);
    await addMember(school, teacher.userId, "teacher");
    const studentEmail = uniqueEmail("editor-student");
    const student = await createUserClient(studentEmail);
    await addMember(school, student.userId, "student");
    const spec = AdventureSpec.parse(
      JSON.parse(
        readFileSync("fixtures/generated/singapore-1819.json", "utf8"),
      ),
    );
    // The generated fixture has a historical-diversion rule. Fix only this disposable copy.
    for (const m of spec.definingMoments)
      m.rules = m.rules.filter(
        (r) =>
          !r.when ||
          !m.outcomes.find(
            (o) =>
              o.id ===
              m.rules.find((f) => f.actId === r.actId && !f.when)?.outcomeId,
          )?.historical ||
          m.outcomes.find((o) => o.id === r.outcomeId)?.historical,
      );
    const { data: row, error } = await admin
      .from("adventures_v3")
      .insert({
        school_id: school,
        owner_id: teacher.userId,
        status: "draft",
        spec,
      })
      .select()
      .single();
    if (error) throw error;
    const captured = fakeOutsideSources(spec);
    // Include real document bodies in the disposable source snapshots, too.
    for (const d of captured.documents)
      for (const doc of spec.documents.filter(
        (doc) => doc.real && doc.citations?.some((c) => c.sourceId === d.id),
      ))
        d.pages[0].text += "\n\n" + doc.body;
    await supabaseV3SourceStore(() => admin).saveOutside(
      row.id,
      captured.sources,
      captured.documents,
    );
    expect(
      validateEditedSpec(
        spec,
        captured.documents.map((d) => ({
          id: d.id,
          title: d.title,
          text: d.pages.map((p) => p.text).join("\n"),
        })),
      ).errors,
    ).toEqual([]);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      const login = async (email: string) => {
        await page.goto("http://localhost:3000/teacher");
        await page
          .getByText("Local dev sign-in (email/password)", { exact: true })
          .click();
        await page.locator('input[name="email"]').fill(email);
        await page.locator('input[name="password"]').fill("password123!");
        await page
          .getByRole("button", { name: "Sign in or create account" })
          .click();
        await page.waitForFunction(
          () => !document.querySelector('input[name="email"]'),
        );
      };
      await login(email);
      await page.goto(`http://localhost:3000/v3/teacher/${row.id}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await page
        .locator("#edit-title")
        .fill("Teacher-edited acceptance adventure");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Saved version 2" })
        .waitFor();
      expect(
        (
          await admin
            .from("adventures_v3")
            .select("spec_version,published_version,status")
            .eq("id", row.id)
            .single()
        ).data,
      ).toMatchObject({
        spec_version: 2,
        published_version: null,
        status: "draft",
      });
      await page.getByRole("link", { name: "Preview", exact: true }).click();
      await page.waitForURL(`**/v3/teacher/${row.id}/preview`);
      expect(
        await page
          .getByRole("button", { name: "Publish", exact: true })
          .count(),
      ).toBe(0);
      await page
        .getByRole("link", { name: "Back to adventure", exact: false })
        .click();
      await page.waitForURL(`**/v3/teacher/${row.id}`);
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await page.getByText("Published · v2", { exact: true }).waitFor();
      expect(
        (
          await admin
            .from("adventures_v3")
            .select("published_version")
            .eq("id", row.id)
            .single()
        ).data?.published_version,
      ).toBe(2);
      expect(
        (
          await admin
            .from("attempts_v3")
            .select("id")
            .eq("adventure_id", row.id)
        ).data,
      ).toEqual([]);
      await page.context().clearCookies();
      await login(studentEmail);
      const { data: release } = await admin
        .from("adventure_publications_v3")
        .select("link_key")
        .eq("adventure_id", row.id)
        .eq("version", 2)
        .single();
      await page.goto(
        `http://localhost:3000/v3/join/${row.id}?release=${release!.link_key}`,
      );
      await page.getByRole("link", { name: "Enter the adventure" }).click();
      await page.waitForURL(/\/v3\/play\/(?!start)/);
      expect(
        (
          await admin
            .from("attempts_v3")
            .select("spec_version")
            .eq("adventure_id", row.id)
        ).data,
      ).toEqual([{ spec_version: 2 }]);
      await page.context().clearCookies();
      await login(email);
      await page.goto(`http://localhost:3000/v3/teacher/${row.id}/links`);
      await page
        .getByRole("heading", { name: "Version history", exact: true })
        .waitFor();
      expect(
        await page
          .getByRole("table")
          .getByText("Live", { exact: true })
          .isVisible(),
      ).toBe(true);
      expect(
        await page.getByRole("link", { name: "View results" }).count(),
      ).toBe(1);
      expect(await page.getByRole("table").innerText()).toContain(
        "Teacher-edited acceptance adventure",
      );
      const openLink = page
        .getByRole("link", { name: "Open link", exact: true })
        .first();
      await openLink.focus();
      expect(await page.getByRole("tooltip").innerText()).toContain(
        "?release=",
      );
      await page.keyboard.press("Escape");
      expect(await page.getByRole("tooltip").count()).toBe(0);
      for (const [screen, suffix] of [
        ["adventure", ""],
        ["history", "/links"],
        ["summary", "/summary"],
        ["preview", "/preview"],
      ] as const) {
        await page.goto(`http://localhost:3000/v3/teacher/${row.id}${suffix}`);
        if (screen !== "adventure") {
          await page
            .getByRole("link", { name: "Back to adventure", exact: false })
            .waitFor();
          expect(
            await page
              .getByRole("button", { name: "Unpublish", exact: true })
              .count(),
          ).toBe(0);
          expect(
            await page
              .getByRole("link", { name: "Back to adventures", exact: true })
              .count(),
          ).toBe(0);
        } else {
          await page
            .getByRole("heading", { name: spec.stages[0].title, exact: true })
            .first()
            .waitFor();
          const checks = page.locator(
            'section[aria-labelledby="needs-fixing"]',
          );
          await checks
            .getByRole("heading", { name: "Checks passed", exact: true })
            .waitFor();
          expect(
            await checks.locator("details").getAttribute("open"),
          ).toBeNull();
          await checks.locator("summary").click();
          expect(
            await checks
              .getByText("No warnings or conflicts recorded.", { exact: true })
              .isVisible(),
          ).toBe(true);
          await checks.locator("summary").click();
        }
        for (const theme of ["light", "dark"]) {
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            localStorage.setItem("historical-adventures-theme", t);
          }, theme);
          for (const width of [1440, 375]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              `${screen} ${theme} ${width} overflow`,
            ).toBe(true);
            await page.screenshot({
              animations: "disabled",
              path: `/tmp/v3-audit-${screen}-${theme}-${width}.png`,
            });
          }
        }
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  180_000,
);
