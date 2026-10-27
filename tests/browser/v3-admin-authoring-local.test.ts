import { readFileSync, mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { addMember, createUserClient, createOrganization, serviceClient, uniqueEmail } from "../db/helpers";

it.runIf(process.env.RUN_VERSION_LOCAL_TESTS === "1")("allows school admins and system admins to open and edit authorized adventures", async () => {
  const origin = process.env.VERSION_TEST_ORIGIN ?? "http://127.0.0.1:3345";
  const school = "00000000-0000-4000-8000-000000003450";
  const admin = serviceClient();
  const owner = await createUserClient(uniqueEmail("admin-edit-owner"));
  await addMember(school, owner.userId, "teacher");
  const schoolAdminEmail = uniqueEmail("admin-edit-school");
  const schoolAdmin = await createUserClient(schoolAdminEmail);
  await addMember(school, schoolAdmin.userId, "admin");
  const systemAdminEmail = uniqueEmail("admin-edit-system");
  const systemAdmin = await createUserClient(systemAdminEmail);
  expect((await admin.from("platform_admin").insert({ user_id: systemAdmin.userId })).error).toBeNull();
  const foreignSchool = await createOrganization("Local foreign admin authoring test");
  const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
  const createAdventure = async (schoolId: string) => {
    const { data, error } = await admin.from("adventures_v3").insert({ owner_id: owner.userId, school_id: schoolId, status: "draft", title: spec.title, spec }).select().single();
    if (error) throw error;
    return data.id as string;
  };
  const ownSchoolAdventure = await createAdventure(school);
  const foreignAdventure = await createAdventure(foreignSchool);
  const browser = await chromium.launch({ headless: true });
  mkdirSync("output/version-management", { recursive: true });
  const errors: string[] = [];
  const login = async (page: Page, email: string) => {
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/teacher`);
    await page.locator("main summary:visible").filter({ hasText: "Local dev sign-in (email/password)" }).click();
    await page.locator('main input[name="email"]').fill(email);
    await page.locator('main input[name="password"]').fill("password123!");
    await page.getByRole("button", { name: "Sign in or create account", exact: true }).click();
    await page.locator('main input[name="email"]').waitFor({ state: "hidden" });
  };
  const editAndExport = async (page: Page, id: string, title: string) => {
    await page.goto(`${origin}/v3/teacher/${id}?view=editor`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.locator("#edit-title").fill(title);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Saved version 2" }).waitFor();
    const { data } = await admin.from("adventures_v3").select("owner_id,spec_version,spec").eq("id", id).single();
    expect(data).toMatchObject({ owner_id: owner.userId, spec_version: 2, spec: { title } });
    await page.getByRole("button", { name: "Import / export", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download JSON", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    await page.screenshot({ path: `output/version-management/${id === foreignAdventure ? "06-system-admin" : "05-school-admin"}-transfer.png` });
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const schoolPage = await context.newPage();
    await login(schoolPage, schoolAdminEmail);
    await editAndExport(schoolPage, ownSchoolAdventure, "School admin edited adventure");
    await schoolPage.getByRole("button", { name: "Close import and export", exact: true }).click();
    const foreign = await schoolPage.goto(`${origin}/v3/teacher/${foreignAdventure}?view=editor`);
    expect(foreign?.status()).toBe(404);
    const systemContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const systemPage = await systemContext.newPage();
    await login(systemPage, systemAdminEmail);
    await editAndExport(systemPage, foreignAdventure, "System admin edited adventure");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 180_000);
