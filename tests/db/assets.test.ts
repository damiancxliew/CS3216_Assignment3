/**
 * D4/D5/D6 over the platform: a published version's story-specific images are
 * generated after publish, stored in the `assets` bucket with the manifest in
 * `asset`, cached by prompt hash, and the play state swaps a ready portrait in
 * for the curated faceset. The image service is faked (no key, no cost); what
 * is real is the bucket, the tables, RLS and the Turn API reading them.
 *
 * Requires a local Supabase (`npm run db:start` / `npm run db:reset`).
 */
import { loadFixtureJson, I1_FIXTURE, loadI1Spec } from "@adventure/generation/fixtures";
import { ImageServiceError, type ImageRequest, type ImageResult, type ImageService } from "@adventure/generation/assets";
import { FakeLlmClient } from "@adventure/orchestration";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { createUserClient, serviceClient, uniqueEmail } from "./helpers";
import { persistSpecVersion } from "@/lib/adventures/persist-spec";
import { generateAssetsForVersion } from "@/lib/assets/generate";
import { loadManifest } from "@/lib/assets/supabase";
import { getState } from "@/lib/play/service";
import { SupabasePlayStore } from "@/lib/play/store";

const admin = serviceClient();

// A 1x1 PNG; the bucket only cares that it is image bytes.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

// The prompt hash includes the model, so a per-run model name keeps one run's cache from leaking into the next.
const RUN_MODEL = `fake-image-${Date.now()}`;

class FakeImages implements ImageService {
  readonly model = RUN_MODEL;
  readonly requests: ImageRequest[] = [];
  constructor(private readonly failFor: (request: ImageRequest) => "filtered" | "failed" | null = () => null) {}
  async generate(request: ImageRequest): Promise<ImageResult> {
    this.requests.push(request);
    const failure = this.failFor(request);
    if (failure === "filtered") throw new ImageServiceError("content-filtered", "blocked");
    if (failure === "failed") throw new ImageServiceError("failed", "boom");
    return { bytes: PNG, mimeType: "image/png", model: this.model, costUsd: 0.01 };
  }
}

let teacher: { client: SupabaseClient; userId: string };
let student: { client: SupabaseClient; userId: string };
let adventureId: string;
let shareToken: string;

beforeAll(async () => {
  teacher = await createUserClient(uniqueEmail("d4-teacher"));
  student = await createUserClient(uniqueEmail("d4-student"));
  const { data: adventure } = await admin.from("adventure").insert({ owner_id: teacher.userId, title: "Singapore, 1819" }).select("id, share_token").single();
  adventureId = adventure!.id as string;
  shareToken = adventure!.share_token as string;
  await persistSpecVersion(admin, adventureId, await loadFixtureJson(I1_FIXTURE.spec), { generatorVersion: "test", createdBy: teacher.userId });
  const { error } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventureId });
  if (error) throw error;
});

describe("asset generation after publish", () => {
  it("writes a manifest with every eligible entity, uploads the images, and never asks for terrain", async () => {
    const spec = await loadI1Spec();
    const images = new FakeImages((r) => (r.kind === "prop" ? "filtered" : null));
    const result = await generateAssetsForVersion({ admin, images, adventureId, version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(images.requests.map((r) => r.kind).every((k) => ["portrait", "landmark", "prop"].includes(k))).toBe(true);
    const manifest = await loadManifest(admin, result.specVersionId, adventureId, 1);
    expect(manifest!.records).toHaveLength(spec.assetEligibility.length);
    const portraits = manifest!.records.filter((r) => r.kind === "portrait");
    expect(portraits.length).toBeGreaterThan(0);
    for (const p of portraits) {
      expect(p.status).toBe("ready");
      expect(p.url).toMatch(/\/storage\/v1\/object\/public\/assets\/adventures\//);
      const fetched = await fetch(p.url);
      expect(fetched.status, p.url).toBe(200);
    }
    const prop = manifest!.records.find((r) => r.kind === "prop")!;
    expect(prop.status).toBe("filtered");
    expect(prop.url).toBe(prop.placeholderUrl); // D6: a filtered image falls back, never blocks
    expect(result.costUsd).toBeCloseTo(0.01 * (spec.assetEligibility.length - 1), 5);
  });

  it("is a cache hit the second time round: same prompts, no new images, no cost", async () => {
    const images = new FakeImages();
    const result = await generateAssetsForVersion({ admin, images, adventureId, version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(images.requests.filter((r) => r.kind !== "prop")).toHaveLength(0); // portraits/landmark cached; the prop retries after its filter
    expect(result.cached).toBeGreaterThan(0);
  });

  it("is readable by the student through RLS, while the cache is not", async () => {
    const { data: joined } = await student.client.rpc("join_adventure", { p_token: shareToken });
    expect(joined).toBeTruthy();
    const { data: rows } = await student.client.from("asset").select("kind, status, url");
    expect(rows!.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("prompt");
    const { data: cache, error } = await student.client.from("asset_cache").select("prompt_hash");
    expect(cache ?? []).toHaveLength(0);
    expect(error).not.toBeNull();
  });

  it("shows the generated portrait in the play state, with the curated faceset for anyone without one", async () => {
    const { data: attempt } = await admin.from("attempt").select("id").eq("adventure_id", adventureId).eq("student_id", student.userId).single();
    const deps = { store: new SupabasePlayStore(admin), llm: new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [] })] }) };
    const result = await getState(deps, attempt!.id as string, student.userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const generated = result.state.agents.filter((a) => a.portraitUrl?.includes("/storage/v1/object/public/assets/"));
    const curated = result.state.agents.filter((a) => a.portraitUrl?.startsWith("/game/ninja/characters/"));
    expect(generated.length + curated.length).toBe(result.state.agents.length);
    expect(generated.length).toBeGreaterThan(0);
  });
});
