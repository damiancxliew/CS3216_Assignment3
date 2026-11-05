import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { expect, it } from "vitest";
import { createState, EngineSpec } from "@adventure/engine";
import { addMember, createUserClient, serviceClient, uniqueEmail, SUPABASE_ANON_KEY, SUPABASE_URL } from "../db/helpers";

// Uses a running local Next server and a local test school.
// Only disposable accounts/adventures are created.
it.runIf(process.env.RUN_SHARED_LOCAL_TESTS === "1")(
  "separates school/library versions, archives, starts, resumes and opens completed v3 results",
  async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(SUPABASE_URL).hostname)) throw Error("Local Supabase required");
    const base = process.env.SHARED_LOCAL_BASE_URL ?? "http://localhost:3105";
    if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local Next server required");
    const school = process.env.SHARED_LOCAL_SCHOOL_ID;
    if (!school) throw Error("Set SHARED_LOCAL_SCHOOL_ID to a local test school");
    const admin = serviceClient();
    const org = await admin.from("organization").select("slug,name").eq("id", school).single();
    if (org.error || !/test|local/i.test(org.data.name)) throw Error("A local test school is required");
    const ownerEmail = uniqueEmail("shared-browser-owner");
    const studentEmail = uniqueEmail("shared-browser-student");
    const owner = await createUserClient(ownerEmail);
    const student = await createUserClient(studentEmail);
    await addMember(school, owner.userId, "admin");
    await addMember(school, student.userId, "student");
    const spec = EngineSpec.parse(JSON.parse(readFileSync(resolve("fixtures/golden-1819.json"), "utf8")));
    spec.title = `Shared v3 ${crypto.randomUUID().slice(0, 8)}`;
    const a = await admin.from("adventures_v3").insert({ school_id: school, owner_id: owner.userId, title: spec.title, spec, status: "draft" }).select("id").single();
    if (a.error) throw a.error;
    const publish = await admin.rpc("publish_adventure_v3", { p_id: a.data.id, p_expected_version: 1, p_expected_published: null, p_publish: true });
    expect(publish.error).toBeNull();
    expect(publish.data).toBe(true);
    const legacyTitle = `Shared v2 ${crypto.randomUUID().slice(0, 8)}`;
    const old = await admin.from("adventure").insert({ organization_id: school, owner_id: owner.userId, title: legacyTitle }).select("id").single();
    if (old.error) throw old.error;
    expect((await admin.from("spec_version").insert({ adventure_id: old.data.id, version: 1, json: {}, generator_version: "shared-browser" })).error).toBeNull();
    expect((await admin.from("adventure").update({ status: "published", published_version: 1 }).eq("id", old.data.id)).error).toBeNull();

    async function login(browser: Browser, email: string): Promise<BrowserContext> {
      let cookies: { name: string; value: string }[] = [];
      const auth = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        cookies: { getAll: () => [], setAll: (values) => { cookies = values; } },
      });
      const result = await auth.auth.signInWithPassword({ email, password: "password123!" });
      if (result.error) throw result.error;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: base, sameSite: "Lax" })));
      return context;
    }
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const errors: string[] = [];
    try {
      const staff = await login(browser, ownerEmail);
      const page = await staff.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${base}/school/${org.data.slug}?tab=adventures`);
      const v3Table = page.getByRole("table", { name: "V3 school adventures and usage" });
      const row = v3Table.getByRole("row").filter({ hasText: spec.title });
      await row.waitFor();
      expect(await v3Table.getByRole("columnheader", { name: "Play time", exact: true }).count()).toBe(0);
      expect(await v3Table.getByRole("columnheader", { name: "Image cost", exact: true }).count()).toBe(0);
      expect(await page.getByRole("table", { name: "V2 school adventures and usage" }).getByRole("columnheader", { name: "Play time", exact: true }).count()).toBe(1);
      expect(await v3Table.evaluate(table => table.parentElement!.scrollWidth <= table.parentElement!.clientWidth)).toBe(true);
      await row.getByRole("button", { name: "Archive", exact: true }).click();
      await row.getByRole("button", { name: "Unarchive", exact: true }).waitFor();
      await row.getByRole("button", { name: "Unarchive", exact: true }).click();
      await row.getByRole("button", { name: "Archive", exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator("table:visible").count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator("article").filter({ hasText: spec.title }).getByRole("button", { name: "Archive", exact: true }).waitFor();

      // A later editable version must not change library metadata or the version started.
      expect((await admin.rpc("save_adventure_v3", { p_id: a.data.id, p_expected_version: 1, p_spec: { ...spec, title: "PRIVATE draft edit" } })).error).toBeNull();
      const pupil = await login(browser, studentEmail);
      const library = await pupil.newPage();
      library.on("pageerror", error => errors.push(error.message));
      await library.goto(`${base}/library`);
      const v3Section = library.getByRole("region", { name: "V3 adventures" });
      const card = v3Section.locator("article").filter({ hasText: spec.title });
      await card.waitFor();
      expect(await v3Section.getByText(legacyTitle, { exact: true }).count()).toBe(0);
      expect(await library.getByRole("region", { name: "V2 adventures" }).getByText(legacyTitle, { exact: true }).count()).toBe(1);
      expect(await library.getByText("PRIVATE draft edit", { exact: true }).count()).toBe(0);
      await card.getByRole("link", { name: "Start", exact: true }).click();
      await library.waitForURL("**/v3/play/*");
      const attemptId = new URL(library.url()).pathname.split("/").at(-1)!;
      const attempt = await admin.from("attempts_v3").select("spec_version").eq("id", attemptId).single();
      expect(attempt.data?.spec_version).toBe(1);
      await library.goto(`${base}/library`);
      expect(await card.getByRole("link", { name: "Resume", exact: true }).getAttribute("href")).toBe(`/v3/play/${attemptId}`);
      const state = createState(spec, "shared-browser-completed");
      state.phase = "reveal"; state.ended = true; state.endingId = spec.endings[0]!.id;
      expect((await admin.from("attempts_v3").update({ state, revision: 1 }).eq("id", attemptId)).error).toBeNull();
      expect((await admin.from("attempt_events_v3").insert({ attempt_id: attemptId, seq: 1, type: "phase", payload: { to: "reveal", at: Date.now(), stageIndex: 0 } })).error).toBeNull();
      await library.reload();
      await card.getByRole("link", { name: "View results", exact: true }).click();
      await library.waitForURL(`**/v3/play/${attemptId}`);
      await library.getByRole("heading", { name: "What happened", exact: true }).waitFor();
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  },
  180_000,
);
