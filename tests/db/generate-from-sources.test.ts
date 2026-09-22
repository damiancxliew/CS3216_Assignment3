/**
 * D1–D4 → P5: the console generates a draft from the adventure's stored
 * sources. What this proves, against a real database and a fake model: a
 * pasted source becomes a planner document with the same pagination the
 * fixture was grounded against, a valid planner reply lands as draft v1 with
 * its stages, a failed generation writes nothing at all, a second generation
 * is refused while a draft is open (P4), and unreadable sources are reported
 * rather than dropped (FR-3).
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FIXTURES_DIR, I1_FIXTURE, loadFixtureJson } from "@adventure/generation/fixtures";
import { FakeLlmClient } from "@adventure/generation/llm";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import {
  generateFromSources,
  sourcesToDocuments,
  type GenerationBrief,
} from "@/lib/adventures/generate-from-sources";

const admin = serviceClient();

const BRIEF: GenerationBrief = {
  setting: "Singapore and Johor, 1819",
  studentRole: "Junior interpreter to the expedition",
  learningObjectives: ["Explain why the EIC wanted a port at the Straits"],
  readingLevel: { band: "lower-secondary", ageMin: 13, ageMax: 14 },
  stageCount: 3,
};

let teacherId: string;
let handoutText: string;
let plannerReply: { json: unknown };

async function newAdventure(): Promise<string> {
  const { data, error } = await admin
    .from("adventure")
    .insert({ owner_id: teacherId, title: "A Post at the River Mouth" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Stores a source exactly as `addTextSource` does. The title doubles as the spec source id via slugify. */
async function addSource(adventureId: string, title: string, text: string) {
  const { error } = await admin.from("source").insert({
    adventure_id: adventureId,
    kind: "text",
    title,
    storage_key: `inline:${crypto.randomUUID()}`,
    page_map: { pages: 1, text },
  });
  if (error) throw error;
}

async function sourcesOf(adventureId: string) {
  const { data } = await admin
    .from("source")
    .select("id, title, kind, page_map")
    .eq("adventure_id", adventureId)
    .order("created_at");
  return data ?? [];
}

async function versionCount(adventureId: string): Promise<number> {
  const { count } = await admin
    .from("spec_version")
    .select("id", { count: "exact", head: true })
    .eq("adventure_id", adventureId);
  return count ?? 0;
}

beforeAll(async () => {
  teacherId = (await createUserClient(uniqueEmail("gen-teacher"))).userId;
  handoutText = await readFile(join(FIXTURES_DIR, I1_FIXTURE.source.file), "utf8");
  // The fixture spec, re-shaped as what the planner returns (server-owned fields stripped).
  const spec = structuredClone(await loadFixtureJson(I1_FIXTURE.spec)) as Record<string, unknown>;
  delete spec.version;
  delete spec.id;
  delete spec.sources;
  delete spec.readingLevel;
  plannerReply = { json: { adventure: spec, missingInformation: ["The handout does not date the second meeting."] } };
});

describe("sourcesToDocuments", () => {
  it("turns pasted sources into planner documents and reports the unreadable ones", () => {
    const { documents, skipped } = sourcesToDocuments([
      { id: "a", title: "Classroom handout", kind: "text", page_map: { pages: 1, text: "Some text." } },
      { id: "b", title: "Classroom handout", kind: "text", page_map: { pages: 1, text: "More text." } },
      { id: "c", title: "Scan", kind: "pdf", page_map: {} },
      { id: "d", title: null, kind: "text", page_map: { pages: 1, text: "   " } },
    ]);
    expect(documents.map((d) => d.id)).toEqual(["classroom-handout", "classroom-handout-2"]);
    expect(documents[0]!.kind).toBe("text");
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toContain("Scan (pdf");
    expect(skipped[1]).toContain("Pasted source");
  });
});

describe("generateFromSources", () => {
  it("lands a valid planner reply as draft v1 and reports missing information", async () => {
    const adventureId = await newAdventure();
    await addSource(adventureId, I1_FIXTURE.source.id, handoutText);

    const result = await generateFromSources({
      admin,
      adventureId,
      adventure: { title: "A Post at the River Mouth", default_timer_seconds: 480 },
      sources: await sourcesOf(adventureId),
      brief: BRIEF,
      llm: new FakeLlmClient([plannerReply]),
      createdBy: teacherId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version.version).toBe(1);
    expect(result.missingInformation).toEqual(["The handout does not date the second meeting."]);

    const { data: version } = await admin
      .from("spec_version")
      .select("version, published_at, generator_version, created_by")
      .eq("id", result.version.specVersionId)
      .single();
    expect(version!.published_at).toBeNull();
    expect(version!.generator_version).toMatch(/^planner:/);
    expect(version!.created_by).toBe(teacherId);

    const { data: stages } = await admin
      .from("stage")
      .select("id")
      .eq("spec_version_id", result.version.specVersionId);
    expect(stages).toHaveLength(3);
  });

  it("writes nothing when the model fails, and says why", async () => {
    const adventureId = await newAdventure();
    await addSource(adventureId, I1_FIXTURE.source.id, handoutText);

    const refused = await generateFromSources({
      admin,
      adventureId,
      adventure: { title: "A Post at the River Mouth", default_timer_seconds: 480 },
      sources: await sourcesOf(adventureId),
      brief: BRIEF,
      llm: new FakeLlmClient([{ refusal: "no" }]),
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/declined/);
    expect(refused.result?.status).toBe("failed");
    expect(await versionCount(adventureId)).toBe(0);
  });

  it("refuses to generate with no readable source", async () => {
    const adventureId = await newAdventure();
    const empty = await generateFromSources({
      admin,
      adventureId,
      adventure: { title: "A Post at the River Mouth", default_timer_seconds: 480 },
      sources: [],
      brief: BRIEF,
      llm: new FakeLlmClient([plannerReply]),
    });
    expect(empty).toEqual({ ok: false, error: "Add at least one source before generating" });
    expect(await versionCount(adventureId)).toBe(0);
  });

  it("refuses a second generation while a draft is open (P4)", async () => {
    const adventureId = await newAdventure();
    await addSource(adventureId, I1_FIXTURE.source.id, handoutText);
    const args = {
      admin,
      adventureId,
      adventure: { title: "A Post at the River Mouth", default_timer_seconds: 480 },
      sources: await sourcesOf(adventureId),
      brief: BRIEF,
    };
    const first = await generateFromSources({ ...args, llm: new FakeLlmClient([plannerReply]) });
    expect(first.ok).toBe(true);

    const second = await generateFromSources({ ...args, llm: new FakeLlmClient([plannerReply]) });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/unpublished draft/);
    expect(await versionCount(adventureId)).toBe(1);
  });
});
