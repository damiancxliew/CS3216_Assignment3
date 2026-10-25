import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { supabaseMediaRepository } from "@/lib/v3/media/repository";
import {
  serviceClient,
  createOrganization,
  createUserClient,
  addMember,
  uniqueEmail,
} from "./helpers";

it("serializes Retry with Continue and restricts immutable candidates to staff", async () => {
  const admin = serviceClient();
  const school = await createOrganization();
  const teacher = await createUserClient(uniqueEmail("media-staff"));
  const student = await createUserClient(uniqueEmail("media-student"));
  await addMember(school, teacher.userId, "teacher");
  await addMember(school, student.userId, "student");
  const spec = AdventureSpec.parse(
    JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  );
  const { data: row, error } = await admin
    .from("adventures_v3")
    .insert({
      school_id: school,
      owner_id: teacher.userId,
      status: "needs_review",
      spec,
    })
    .select("id,spec_version")
    .single();
  if (error) throw error;
  try {
    const { error: sourceError } = await admin
      .from("sources_v3")
      .insert({
        adventure_id: row.id,
        source_key: "outside-record",
        origin: "outside",
        kind: "text",
        title: "Record",
        url: "https://nlb.gov.sg/record",
        content_hash: "test",
        pages: [{ page: 1, text: "Accepted evidence" }],
      });
    if (sourceError) throw sourceError;
    const request = {
      p_adventure_id: row.id,
      p_requester_id: teacher.userId,
      p_key: "retry-one",
      p_hash: "hash",
      p_excluded: ["outside-record"],
      p_brief: {
        adventureId: row.id,
        ownerId: teacher.userId,
        schoolId: school,
      },
    };
    const [retry, continued] = await Promise.all([
      admin.rpc("begin_source_search_v3", request),
      admin.rpc("continue_sources_v3", {
        p_adventure_id: row.id,
        p_excluded: [],
      }),
    ]);
    expect(Number(!retry.error) + Number(continued.data === true)).toBe(1);
    if (!retry.error) {
      const duplicate = await admin.rpc("begin_source_search_v3", request);
      expect(duplicate.data).toBe(retry.data);
      expect(
        (
          await admin.rpc("begin_source_search_v3", {
            ...request,
            p_hash: "changed",
          })
        ).error?.message,
      ).toContain("Idempotency");
      const { error: failError } = await admin
        .from("job_steps")
        .update({ status: "failed" })
        .eq("job_id", row.id)
        .eq("name", `source-retry:${retry.data}`);
      if (failError) throw failError;
      expect(
        (
          await admin
            .from("source_search_runs_v3")
            .select("state")
            .eq("id", retry.data)
            .single()
        ).data?.state,
      ).toBe("failed");
      expect(
        (
          await admin.rpc("continue_sources_v3", {
            p_adventure_id: row.id,
            p_excluded: ["outside-record"],
          })
        ).data,
      ).toBe(true);
      expect(
        (
          await admin
            .from("sources_v3")
            .select("excluded,pages")
            .eq("adventure_id", row.id)
            .single()
        ).data,
      ).toMatchObject({
        excluded: true,
        pages: [{ page: 1, text: "Accepted evidence" }],
      });
    }
    const media = supabaseMediaRepository(admin);
    const input = {
      adventureId: row.id,
      creatorId: teacher.userId,
      target: { kind: "stage" as const, key: spec.stages[0].id },
      origin: "upload" as const,
      specVersion: row.spec_version,
      idempotencyKey: "candidate-one",
      inputHash: "hash",
      input: {},
      permission: {
        basis: "Private permission",
        confirmedBy: teacher.userId,
        confirmedAt: new Date().toISOString(),
      },
    };
    const item = await media.reserve(input);
    expect((await media.reserve(input)).id).toBe(item.id);
    await expect(
      media.reserve({ ...input, inputHash: "different" }),
    ).rejects.toThrow(/Idempotency/);
    expect(await media.get(crypto.randomUUID(), item.id)).toBeNull();
    await media.complete(row.id, item.id, {
      candidateId: item.id,
      origin: "upload",
      url: "https://assets.example/immutable.webp",
      format: "webp",
      caption: "Harbour",
      alt: "Harbour",
      credit: "Teacher",
    });
    const tamper = await admin
      .from("adventure_media_v3")
      .update({ snapshot: {} })
      .eq("id", item.id);
    expect(tamper.error?.message).toContain("immutable");
    expect(
      (await student.client.from("adventure_media_v3").select("id")).data,
    ).toEqual([]);
    expect(
      (
        await teacher.client
          .from("adventure_media_v3")
          .select("id")
          .eq("adventure_id", row.id)
      ).data,
    ).toEqual([{ id: item.id }]);
    expect(
      (
        await teacher.client
          .from("adventure_media_v3")
          .update({ state: "failed" })
          .eq("id", item.id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await student.client.rpc("continue_sources_v3", {
          p_adventure_id: row.id,
          p_excluded: [],
        })
      ).error,
    ).not.toBeNull();
    const generated = await media.reserve({
      ...input,
      idempotencyKey: "ai-one",
      inputHash: "ai",
      origin: "ai",
    });
    const queued = await admin
      .from("job_steps")
      .select("name")
      .eq("job_id", row.id)
      .eq("name", `media:${generated.id}`);
    expect(queued.data).toHaveLength(1);
    await admin
      .from("job_steps")
      .update({ status: "failed" })
      .eq("job_id", row.id)
      .eq("name", `media:${generated.id}`);
    expect((await media.get(row.id, generated.id))?.state).toBe("failed");
  } finally {
    await admin.from("job_steps").delete().eq("job_id", row.id);
    await admin.from("adventures_v3").delete().eq("id", row.id);
    await admin.auth.admin.deleteUser(teacher.userId);
    await admin.auth.admin.deleteUser(student.userId);
    await admin.from("organization").delete().eq("id", school);
  }
});
