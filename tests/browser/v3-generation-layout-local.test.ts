import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { validateSpec } from "@adventure/spec-v3";
import { serviceClient, createUserClient, addMember, uniqueEmail, TESTING_SCHOOL_ID } from "../db/helpers";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { fakeGenerationPasses } from "@/lib/v3/generation/fake-passes";

// Real Next/Supabase screens, with disposable stored generation outputs. No model calls.
it.runIf(process.env.RUN_GENERATION_LAYOUT_LOCAL === "1")("keeps generation controls anchored between real review stages", async () => {
  const origin = process.env.GENERATION_LAYOUT_ORIGIN ?? "http://127.0.0.1:3237";
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw Error("Local app required");
  const admin = serviceClient();
  const email = uniqueEmail("generation-layout");
  const teacher = await createUserClient(email);
  const store = supabaseV3BriefStore(admin);
  let id: string | undefined;
  const browser = await chromium.launch({ headless: true });
  const output = "output/v3-generation-layout";
  const errors: string[] = [];
  try {
    await mkdir(output, { recursive: true });
    await addMember(TESTING_SCHOOL_ID, teacher.userId, "teacher");
    id = await store.create({ schoolId: TESTING_SCHOOL_ID, ownerId: teacher.userId });
    const state = initialBriefStateV3(id);
    state.draft = { episode: "Singapore in 1819", focus: "", readingLevel: "sec", timerMinutes: 45, mode: "guided", sourcePolicy: { allowAny: false, extraDomains: [] }, sources: { summary: "Historical handout", episodeProposal: "Singapore in 1819" } };
    state.sources = [{ id: "layout-source", title: "Classroom handout", kind: "text" }];
    await store.save(id, state);
    const passes = fakeGenerationPasses({ V3_FAKE_PASSES: "1" })!;
    const skeleton = await passes.skeleton({} as never);
    if (!skeleton.ok) throw Error("Fixture outline invalid");
    const parsed = validateSpec(JSON.parse(await readFile("fixtures/golden-1819.json", "utf8")));
    if (!parsed.ok) throw Error("Fixture invalid");
    const input = { adventureId: id, schoolId: TESTING_SCHOOL_ID, ownerId: teacher.userId, episode: "Singapore in 1819", readingLevel: "sec", mode: "guided", sourcePolicy: state.draft.sourcePolicy };
    const rows = ["sources", "skeleton"].map(name => ({ job_id: id, name, step: `v3.gen.${name}`, status: "succeeded", input, output: name === "skeleton" ? { skeleton: skeleton.skeleton } : { rejected: [] } }));
    const inserted = await admin.from("job_steps").insert(rows);
    if (inserted.error) throw inserted.error;
    const update = await admin.from("adventures_v3").update({ status: "needs_review" }).eq("id", id);
    if (update.error) throw update.error;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${origin}/teacher`);
    await page.locator("main summary:visible").filter({ hasText: "Local dev sign-in (email/password)" }).click();
    await page.locator('main input[name="email"]:visible').fill(email);
    await page.locator('main input[name="password"]:visible').fill("password123!");
    await page.getByRole("button", { name: "Sign in or create account", exact: true }).click();
    await page.getByRole("heading", { name: "Choose your next adventure", exact: true }).waitFor();
    const positions = [];
    for (const pass of ["skeleton", "details", "endings", "reveal"] as const) {
      if (pass !== "skeleton") {
        const inserted = await admin.from("job_steps").insert({ job_id: id, name: pass, step: `v3.gen.${pass}`, status: "succeeded", input, output: pass === "details" ? { draft: parsed.spec } : { spec: parsed.spec } });
        if (inserted.error) throw inserted.error;
      }
      await page.goto(`${origin}/v3/teacher/${id}`);
      await page.locator(`[data-generation-section="${pass}"]`).waitFor();
      const toolbar = page.locator("[data-review-toolbar]");
      await toolbar.waitFor();
      expect(await toolbar.getByRole("button", { name: "Resolve issues", exact: true }).innerText()).toBe("Resolve issues");
      positions.push(await toolbar.evaluate(node => {
        const rect = (selector: string) => { const { x, y, width, height } = node.querySelector(selector)!.getBoundingClientRect(); return { x, y, width, height }; };
        return { discard: rect('[aria-label^="Discard"]'), primary: rect('[aria-label="Continue generation"]'), resolve: rect('[aria-label="Issue suggestions"]'), radius: getComputedStyle(node).borderRadius };
      }));
      const sections = await page.locator("[data-generation-section]").evaluateAll(nodes => nodes.map(node => ({ pass: node.getAttribute("data-generation-section"), heading: node.querySelector("h2")?.textContent })));
      expect(sections.every(section => /^0[1-6] · /.test(section.heading ?? ""))).toBe(true);
      // Completed passes render as read-only cards inside their numbered section, not collapsed history cards.
      expect(await page.locator("details[data-generation-history-card]").count()).toBe(0);
      expect(await page.getByRole("region", { name: "Adventure plan", exact: true }).getByRole("heading", { level: 3 }).count()).toBe(1);
      await page.screenshot({ path: `${output}/${pass}.png` });
    }
    positions.forEach(position => expect(position).toEqual(positions[0]));
    expect(errors).toEqual([]);
    await writeFile(`${output}/verification.json`, JSON.stringify({ positions, browserErrors: errors, fixture: "Disposable local review outputs; no models or publishing" }, null, 2));
  } finally {
    await browser.close();
    if (id) { await admin.from("job_steps").delete().eq("job_id", id); await admin.from("adventures_v3").delete().eq("id", id); }
    await admin.auth.admin.deleteUser(teacher.userId);
  }
}, 120000);
