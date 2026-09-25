/**
 * A generation step that throws is the one failure a teacher cannot see into:
 * the job row is all that survives the request. What this proves, against a
 * real database: a step that dies on server misconfiguration or on sources
 * that moved under it records why, not just that something went wrong.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { beforeAll, afterEach, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import { sourcesToDocuments } from "@/lib/adventures/generate-from-sources";
import { advanceGenerationJob, startGenerationJob } from "@/lib/adventures/resumable-generation";

const admin = serviceClient();

const TEACHER = {
  setting: "Singapore and Johor, 1819",
  studentRole: "Junior interpreter to the expedition",
  learningObjectives: ["Explain why the EIC wanted a port at the Straits"],
  readingLevel: { band: "lower-secondary", ageMin: 13, ageMax: 14 },
  stageCount: 3,
};

let teacherId: string;
const apiKey = process.env.OPENAI_API_KEY;

async function startedJob(): Promise<string> {
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({ owner_id: teacherId, title: "A Post at the River Mouth" })
    .select("id")
    .single();
  if (error) throw error;
  const adventureId = adventure.id as string;

  const { error: sourceError } = await admin.from("source").insert({
    adventure_id: adventureId,
    kind: "text",
    title: "Classroom handout",
    storage_key: `inline:${crypto.randomUUID()}`,
    page_map: { pages: 1, text: "The expedition reached the river mouth in January 1819." },
  });
  if (sourceError) throw sourceError;

  const { data: sources } = await admin
    .from("source")
    .select("id, title, kind, page_map, content_hash")
    .eq("adventure_id", adventureId)
    .order("created_at");
  await startGenerationJob(admin, {
    adventureId,
    teacher: TEACHER,
    documents: sourcesToDocuments(sources ?? []).documents,
    warnings: [],
    createdBy: teacherId,
  });
  return adventureId;
}

async function jobRow(adventureId: string) {
  const { data } = await admin
    .from("generation_job")
    .select("state, phase, message")
    .eq("adventure_id", adventureId)
    .maybeSingle<{ state: string; phase: string; message: string | null }>();
  return data;
}

beforeAll(async () => {
  teacherId = (await createUserClient(uniqueEmail("resumable-teacher"))).userId;
});

afterEach(() => {
  if (apiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = apiKey;
});

describe("advanceGenerationJob failure reporting", () => {
  it("names a missing model key instead of failing anonymously", async () => {
    const adventureId = await startedJob();
    delete process.env.OPENAI_API_KEY;

    const result = await advanceGenerationJob(admin, adventureId);

    expect(result.state).toBe("failed");
    expect(result.message).toContain("OPENAI_API_KEY");
    const job = await jobRow(adventureId);
    expect(job).toMatchObject({ state: "failed", phase: "failed" });
    expect(job!.message).toContain("OPENAI_API_KEY");
  });

  it("says the sources moved when the snapshot no longer matches", async () => {
    const adventureId = await startedJob();
    await admin.from("source").delete().eq("adventure_id", adventureId);

    const result = await advanceGenerationJob(admin, adventureId);

    expect(result.state).toBe("failed");
    expect(result.message).toContain("Sources changed during generation");
    expect((await jobRow(adventureId))!.message).toContain("Sources changed during generation");
  });
});
