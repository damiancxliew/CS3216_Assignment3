import { createHash } from "node:crypto";
import { z } from "zod";
import { AdventureSpec, type MediaSnapshot } from "@adventure/spec-v3";
import { fetchSourceBytes } from "@adventure/generation";
import type { AssetStore } from "@adventure/generation/assets";
import type { V3PlayStore } from "@/lib/play/v3/store";
import { canStaffAdventure } from "@/lib/play/v3/access";
import { normalizeImageUpload, validateSpriteUpload } from "./uploads";
import {
  approvedHttps,
  providerMetadata,
  RESOURCE_PROVIDERS,
} from "./providers";
import { isSprite, validTarget } from "./resolvers";
import type { MediaCandidate, MediaRepository } from "./repository";
export const MediaTargetInput = z.strictObject({
  kind: z.enum(["stage", "portrait", "playerSprite", "characterSprite"]),
  key: z.string().min(1).max(200),
});
export const MediaInput = z.strictObject({
  target: MediaTargetInput,
  version: z.number().int().positive(),
  key: z.string().min(1).max(128),
  caption: z.string().trim().min(1).max(2000),
  alt: z.string().trim().min(1).max(1000),
  credit: z.string().trim().max(2000).default(""),
  sourceUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//)
    .optional(),
});
export type MediaInput = z.infer<typeof MediaInput>;
export const CreateMediaInput = z.discriminatedUnion("origin", [
  MediaInput.extend({
    origin: z.literal("un"),
    imageUrl: z.string().url(),
    recordUrl: z.string().url(),
    basis: z.string().trim().min(1).max(4000),
    confirmed: z.literal(true),
  }),
  MediaInput.extend({
    origin: z.enum(["commons", "loc"]),
    itemId: z.string().min(1).max(500),
  }),
  MediaInput.extend({
    origin: z.literal("ai"),
    appearance: z.string().trim().min(1).max(2000),
  }),
]);
export type CreateMediaInput = z.infer<typeof CreateMediaInput>;
export type MediaDeps = {
  play: V3PlayStore;
  media: MediaRepository;
  storage: AssetStore;
  env?: NodeJS.ProcessEnv;
};
export async function requireMediaAdventure(
  deps: Pick<MediaDeps, "play" | "env">,
  userId: string,
  adventureId: string,
  version?: number,
) {
  const adventure = await deps.play.loadAdventure(adventureId);
  if (
    !adventure ||
    !(await canStaffAdventure(deps.play, adventure, userId, deps.env)) ||
    !["draft", "published", "archived"].includes(adventure.status)
  )
    throw Error("Adventure not found.");
  if (version !== undefined && adventure.specVersion !== version)
    throw Error(
      "This adventure changed. Save or reload before creating assets.",
    );
  return { adventure, spec: AdventureSpec.parse(adventure.spec) };
}
export const mediaInputHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function storeCandidateBytes(
  storage: AssetStore,
  adventureId: string,
  id: string,
  result: Awaited<ReturnType<typeof normalizeImageUpload>>,
) {
  const hash = createHash("sha256").update(result.bytes).digest("hex");
  const storageKey = `v3/media/${adventureId}/${id}/${hash}.${result.format}`;
  const url = await storage.put(
    storageKey,
    result.bytes,
    `image/${result.format}`,
  );
  return {
    url,
    storageKey,
    width: result.width,
    height: result.height,
    format: result.format,
  };
}
export async function uploadMedia(
  deps: MediaDeps,
  userId: string,
  adventureId: string,
  raw: unknown,
  bytes: Uint8Array,
): Promise<MediaCandidate> {
  const input = MediaInput.parse(raw);
  const { spec } = await requireMediaAdventure(
    deps,
    userId,
    adventureId,
    input.version,
  );
  if (!validTarget(spec, input.target)) throw Error("Asset slot unavailable.");
  // Validate before reservation: invalid uploads are never selectable candidates.
  const result = await (isSprite(input.target)
    ? validateSpriteUpload(bytes)
    : normalizeImageUpload(bytes));
  const item = await deps.media.reserve({
    adventureId,
    creatorId: userId,
    target: input.target,
    origin: "upload",
    specVersion: input.version,
    idempotencyKey: input.key,
    inputHash: mediaInputHash({
      input,
      bytes: createHash("sha256").update(bytes).digest("hex"),
    }),
    input,
  });
  if (item.state !== "pending") return item;
  try {
    const location = await storeCandidateBytes(
      deps.storage,
      adventureId,
      item.id,
      result,
    );
    await deps.media.complete(adventureId, item.id, {
      candidateId: item.id,
      origin: "upload",
      ...location,
      caption: input.caption,
      alt: input.alt,
      credit: input.credit,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(isSprite(input.target)
        ? { spriteLayout: "4x4-down-up-left-right" as const }
        : {}),
    });
  } catch (cause) {
    await deps.media.fail(
      adventureId,
      item.id,
      "Could not store the image. Upload again with a new request.",
    );
    throw cause;
  }
  return (await deps.media.get(adventureId, item.id))!;
}
export async function createMedia(
  deps: MediaDeps,
  userId: string,
  adventureId: string,
  raw: unknown,
): Promise<MediaCandidate> {
  const input = CreateMediaInput.parse(raw);
  const { spec } = await requireMediaAdventure(
    deps,
    userId,
    adventureId,
    input.version,
  );
  if (!validTarget(spec, input.target)) throw Error("Asset slot unavailable.");
  if (isSprite(input.target) && input.origin !== "ai")
    throw Error(
      "Use bundled sprites, upload a walking sheet, or generate with AI.",
    );
  if (input.origin === "un") {
    approvedHttps(input.imageUrl, RESOURCE_PROVIDERS.un.imageHosts, true);
    approvedHttps(input.recordUrl, RESOURCE_PROVIDERS.un.recordHosts, true);
    if (!input.credit) throw Error("UN images require credit.");
  }
  const item = await deps.media.reserve({
    adventureId,
    creatorId: userId,
    target: input.target,
    origin: input.origin,
    specVersion: input.version,
    idempotencyKey: input.key,
    inputHash: mediaInputHash(input),
    input,
    ...(input.origin === "un"
      ? {
          permission: {
            basis: input.basis,
            confirmedBy: userId,
            confirmedAt: new Date().toISOString(),
          },
        }
      : {}),
  });
  if (item.state !== "pending" || input.origin === "ai") return item;
  try {
    let snapshot: MediaSnapshot;
    if (input.origin === "un") {
      // Intentionally no fetch, optimization, proxy, download or storage operation.
      snapshot = {
        candidateId: item.id,
        origin: "un",
        url: input.imageUrl,
        format: "external",
        caption: input.caption,
        alt: input.alt,
        credit: input.credit,
        sourceUrl: input.recordUrl,
      };
    } else {
      // Metadata is fetched again by provider ID. Never trust a search card's URL or licence.
      const metadata = await providerMetadata(input.origin, input.itemId);
      const fetched = await fetchSourceBytes(metadata.imageUrl, {
        policy: {
          extraDomains: [...RESOURCE_PROVIDERS[input.origin].imageHosts],
        },
        allowedHosts: RESOURCE_PROVIDERS[input.origin].imageHosts,
        contentTypes: ["image/jpeg", "image/png", "image/webp"],
        maxBytes: 10 * 1024 * 1024,
      });
      const normalized = await normalizeImageUpload(fetched.bytes);
      const location = await storeCandidateBytes(
        deps.storage,
        adventureId,
        item.id,
        normalized,
      );
      snapshot = {
        candidateId: item.id,
        origin: input.origin,
        ...location,
        caption: input.caption,
        alt: input.alt,
        credit: metadata.credit,
        sourceUrl: metadata.recordUrl,
        licence: metadata.licence,
      };
    }
    await deps.media.complete(adventureId, item.id, snapshot);
  } catch (cause) {
    await deps.media.fail(
      adventureId,
      item.id,
      cause instanceof Error ? cause.message : "Could not import image.",
    );
  }
  return (await deps.media.get(adventureId, item.id))!;
}
