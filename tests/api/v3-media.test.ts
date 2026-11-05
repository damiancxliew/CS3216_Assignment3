import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { ImageServiceError } from "@adventure/generation/assets";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import {
  uploadMedia,
  createMedia,
  type MediaDeps,
} from "@/lib/v3/media/service";
import {
  type MediaCandidate,
  type MediaRepository,
  resolveMediaCandidates,
} from "@/lib/v3/media/repository";
import { saveAdventureEdits } from "@/lib/v3/edit/service";
import { generateMediaCandidate } from "@/lib/v3/media/generate";
import {
  resolveAdventureImages,
  resolveWalkingSprites,
} from "@/lib/v3/media/resolvers";
function setup() {
  const spec = AdventureSpec.parse(
    JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  );
  const play = new MemoryV3PlayStore();
  play.addAdventure({
    id: "adv",
    ownerId: "teacher",
    schoolId: "school",
    status: "published",
    specVersion: 1,
    spec,
  });
  play.addMember("school", "teacher");
  const rows = new Map<string, MediaCandidate>(),
    requests = new Map<string, { hash: string; id: string }>();
  const media: MediaRepository = {
    async reserve(input) {
      const key = `${input.adventureId}:${input.creatorId}:${input.idempotencyKey}`,
        prior = requests.get(key);
      if (prior) {
        if (prior.hash !== input.inputHash) throw Error("Idempotency conflict");
        return structuredClone(rows.get(prior.id)!);
      }
      const id = randomUUID();
      requests.set(key, { hash: input.inputHash, id });
      const item: MediaCandidate = {
        id,
        adventureId: input.adventureId,
        creatorId: input.creatorId,
        target: input.target,
        origin: input.origin,
        state: "pending",
        snapshot: null,
        specVersion: input.specVersion,
        failure: null,
        costUsd: 0,
        createdAt: new Date().toISOString(),
      };
      rows.set(id, item);
      return structuredClone(item);
    },
    async get(adventure, id) {
      const row = rows.get(id);
      return row?.adventureId === adventure ? structuredClone(row) : null;
    },
    async list(adventure) {
      return [...rows.values()]
        .filter((row) => row.adventureId === adventure)
        .map((row) => structuredClone(row));
    },
    async complete(adventure, id, snapshot, cost = 0) {
      const row = rows.get(id)!;
      if (row.adventureId === adventure && row.state === "pending") {
        row.state = "ready";
        row.snapshot = structuredClone(snapshot);
        row.costUsd = cost;
      }
    },
    async fail(adventure, id, message, cost = 0) {
      const row = rows.get(id)!;
      if (row.adventureId === adventure && row.state === "pending") {
        row.state = "failed";
        row.failure = message;
        row.costUsd = cost;
      }
    },
  };
  const objects = new Map<string, Uint8Array>();
  const storage = {
    put: vi.fn(async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
      return `https://assets.example/${key}`;
    }),
    download: vi.fn(async (): Promise<Uint8Array | null> => null),
  };
  const deps: MediaDeps = {
    play,
    media,
    storage,
    env: {},
  };
  const input = {
    target: { kind: "stage" as const, key: spec.stages[0].id },
    version: 1,
    key: "upload-one",
    caption: "Harbour",
    alt: "Historical harbour illustration",
    credit: "Teacher",
  };
  const png = () =>
    sharp({
      create: { width: 120, height: 80, channels: 4, background: "#ddaa77" },
    })
      .png()
      .toBuffer();
  return { spec, play, media, storage, deps, input, png };
}
describe("media authoring", () => {
  it("uploads a candidate, saves selection and story together, and preserves an old publication", async () => {
    const { deps, input, png, spec, play } = setup();
    const item = await uploadMedia(deps, "teacher", "adv", input, await png());
    expect((await play.loadAdventure("adv"))!.specVersion).toBe(1);
    const result = await saveAdventureEdits(
      {
        store: play,
        media: deps.media,
        env: deps.env,
        sources: async () => [],
        queueStageArt: async () => {},
      },
      "teacher",
      "adv",
      1,
      [
        {
          type: "stageImage",
          targetKey: input.target.key,
          candidateId: item.id,
        },
        { type: "set", path: ["title"], value: "Edited title" },
      ],
    );
    expect(result).toMatchObject({ ok: true, version: 2 });
    const current = AdventureSpec.parse(
      (await play.loadAdventure("adv"))!.spec,
    );
    expect(current.title).toBe("Edited title");
    expect(
      JSON.stringify(resolveAdventureImages(current, "adv", 2)),
    ).not.toContain("storageKey");
    expect(resolveAdventureImages(current, "adv", 2).stageImages[0].url).toBe(
      item.snapshot!.url,
    );
    expect(await play.loadVersionSpec("adv", 1)).toEqual(spec);
    expect((await play.loadAdventure("adv"))!.publishedVersion).toBe(1);
  });
  it("rejects unauthorized, stale, cross-adventure and target-mismatched candidates", async () => {
    const { deps, input, png, play } = setup();
    await expect(
      uploadMedia(deps, "outsider", "adv", input, await png()),
    ).rejects.toThrow(/not found/);
    await expect(
      uploadMedia(
        deps,
        "teacher",
        "adv",
        { ...input, version: 2 },
        await png(),
      ),
    ).rejects.toThrow(/changed/);
    const item = await uploadMedia(deps, "teacher", "adv", input, await png());
    await expect(
      resolveMediaCandidates(deps.media, "another-adventure", [item.id]),
    ).rejects.toThrow(/unavailable/);
    const result = await saveAdventureEdits(
      {
        store: play,
        media: deps.media,
        env: deps.env,
        sources: async () => [],
        queueStageArt: async () => {},
      },
      "teacher",
      "adv",
      1,
      [
        {
          type: "portraitImage",
          targetKey: "temenggong:t1",
          candidateId: item.id,
        },
      ],
    );
    expect(result).toMatchObject({
      ok: false,
      code: "invalid-edit",
      message: expect.stringMatching(/target/),
    });
  });
  it("reuses identical upload submissions and conflicts on different input", async () => {
    const { deps, input, png } = setup(),
      bytes = await png();
    const first = await uploadMedia(deps, "teacher", "adv", input, bytes);
    const second = await uploadMedia(deps, "teacher", "adv", input, bytes);
    expect(first.id).toBe(second.id);
    expect(deps.storage.put).toHaveBeenCalledTimes(1);
    await expect(
      uploadMedia(deps, "teacher", "adv", { ...input, alt: "Changed" }, bytes),
    ).rejects.toThrow(/Idempotency/);
  });
  it("embeds UN links without fetching or storing bytes or exposing permission in the snapshot", async () => {
    const { deps, input } = setup();
    const item = await createMedia(deps, "teacher", "adv", {
      ...input,
      origin: "un",
      imageUrl: "https://dam.media.un.org/image.jpg",
      recordUrl: "https://media.un.org/record/1",
      credit: "UN Photo/Photographer",
      basis: "Written permission for the lesson",
      confirmed: true,
    });
    expect(item.state).toBe("ready");
    expect(deps.storage.put).not.toHaveBeenCalled();
    expect(deps.storage.download).not.toHaveBeenCalled();
    expect(JSON.stringify(item.snapshot)).not.toMatch(
      /basis|confirmedBy|permission/,
    );
    await expect(
      createMedia(deps, "teacher", "adv", {
        ...input,
        key: "lookalike",
        origin: "un",
        imageUrl: "https://un.org.example.com/image.jpg",
        recordUrl: "https://un.org/record",
        credit: "UN",
        basis: "Fair use",
        confirmed: true,
      }),
    ).rejects.toThrow(/approved/);
  });
  it("late AI success creates a candidate and cannot replace an uploaded selection", async () => {
    const { deps, input, png, spec } = setup();
    const upload = await uploadMedia(
      deps,
      "teacher",
      "adv",
      input,
      await png(),
    );
    spec.authoring = {
      stageImages: {
        [input.target.key]: { type: "candidate", candidate: upload.snapshot! },
      },
    };
    const request = {
      ...input,
      key: "generate",
      origin: "ai" as const,
      appearance: "Sunlit harbour",
    };
    const item = await createMedia(deps, "teacher", "adv", request);
    const before = JSON.stringify(spec);
    await generateMediaCandidate(
      {
        ...deps,
        images: {
          model: "test",
          generate: async () => ({
            bytes: await png(),
            mimeType: "image/png",
            model: "test",
            costUsd: 0.03,
          }),
        },
      },
      item,
      spec,
      request,
    );
    expect((await deps.media.get("adv", item.id))?.state).toBe("ready");
    expect(JSON.stringify(spec)).toBe(before);
    expect(
      resolveAdventureImages(spec, "adv", 1).stageImages[0].metadata!
        .candidateId,
    ).toBe(upload.id);
  });
  it("saves all stance selections in one revision and leaves existing releases pinned", async () => {
    const { deps, input, spec, png, play } = setup();
    const character = spec.characters.find(c => c.tier === "major")!;
    if (character.tier !== "major") throw Error("Major required");
    const key = `${character.id}:${character.stances[0].id}`;
    const item = await uploadMedia(deps, "teacher", "adv", { ...input, target: { kind: "portrait", key } }, await png());
    const result = await saveAdventureEdits({ store: play, media: deps.media, env: deps.env, sources: async () => [], queueStageArt: async () => {} },
      "teacher", "adv", 1, [{ type: "portraitImage", targetKey: key, candidateId: item.id, allStances: true }]);
    expect(result).toMatchObject({ ok: true, version: 2 });
    const current = AdventureSpec.parse((await play.loadAdventure("adv"))!.spec);
    for (const stance of character.stances)
      expect(current.authoring?.portraitImages?.[`${character.id}:${stance.id}`]).toEqual({ type: "candidate", candidate: item.snapshot });
    expect((await play.loadAdventure("adv"))!.publishedVersion).toBe(1);
    expect(await play.loadVersionSpec("adv", 1)).toEqual(spec);
  });
  it("generates a stance with the original stored portrait bytes and rejects other characters", async () => {
    const { deps, input, spec, png, storage } = setup();
    const character = spec.characters.find(c => c.tier === "major")!;
    if (character.tier !== "major") throw Error("Major required");
    const source = await uploadMedia(deps, "teacher", "adv", {
      ...input, target: { kind: "portrait", key: `${character.id}:${character.stances[0].id}` },
    }, await png());
    const request = {
      ...input, key: "stance-variant", origin: "ai" as const,
      target: { kind: "portrait" as const, key: `${character.id}:${character.stances[1].id}` },
      appearance: "Keep the original appearance", referenceCandidateId: source.id,
    };
    const bytes = new Uint8Array(await png());
    storage.download.mockResolvedValue(bytes);
    const generate = vi.fn(async () => ({ bytes, mimeType: "image/png" as const, model: "test", costUsd: 0.03 }));
    const item = await createMedia(deps, "teacher", "adv", request);
    await generateMediaCandidate({ ...deps, images: { model: "test", generate } }, item, spec, request);
    expect((await deps.media.get("adv", item.id))?.state).toBe("ready");
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      referenceImage: { bytes, mimeType: "image/webp" },
      prompt: expect.stringContaining("Preserve the same face"),
    }));
    const other = spec.characters.find(c => c.id !== character.id)!;
    await expect(createMedia(deps, "teacher", "adv", {
      ...request, key: "wrong-character", target: { kind: "portrait", key: other.tier === "major" ? `${other.id}:${other.stances[0].id}` : other.id },
    })).rejects.toThrow(/reference/i);
    storage.download.mockResolvedValue(null);
    const missing = await createMedia(deps, "teacher", "adv", { ...request, key: "missing-source" });
    await generateMediaCandidate({ ...deps, images: { model: "test", generate } }, missing, spec, request);
    expect((await deps.media.get("adv", missing.id))?.state).toBe("failed");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("retains rejected sprite-generation cost and never exposes the sheet as ready", async () => {
    const { deps, input, spec } = setup();
    const request = {
      ...input,
      target: { kind: "playerSprite" as const, key: "player" },
      key: "sprite-ai",
      origin: "ai" as const,
      appearance: "Period interpreter",
    };
    const item = await createMedia(deps, "teacher", "adv", request);
    const before = resolveWalkingSprites(spec);
    await generateMediaCandidate(
      {
        ...deps,
        images: {
          model: "test",
          generate: async () => {
            throw new ImageServiceError("failed", "Pose template mismatch", {
              bytes: new Uint8Array(),
              mimeType: "image/png",
              costUsd: 0.12,
            });
          },
        },
      },
      item,
      spec,
      request,
    );
    expect(await deps.media.get("adv", item.id)).toMatchObject({
      state: "failed",
      snapshot: null,
      costUsd: 0.12,
      failure: expect.stringContaining("Pose"),
    });
    expect(resolveWalkingSprites(spec)).toEqual(before);
  });
});
