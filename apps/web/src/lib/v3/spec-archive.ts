import { randomUUID } from "node:crypto";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import type { MediaSnapshot } from "@adventure/spec-v3";
import { MAX_SPEC_BYTES, parseSpecImport, type SpecBundle } from "./spec-transfer";
import { normalizeImageUpload, validateSpriteUpload, type NormalizedMedia } from "./media/uploads";

// Kept below the existing 16 MB server-action request limit.
export const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 200;
const Manifest = z.array(z.strictObject({ url: z.url(), path: z.string().regex(/^assets\/[0-9]+\.bin$/) })).max(MAX_ENTRIES - 2);
type MediaRef = { url: string; sprite: boolean; replace(media: NormalizedMedia & { url: string; storageKey: string }): void };

/** Only presentation URLs are media; citations and attribution links are never fetched. */
function mediaRefs(bundle: SpecBundle): MediaRef[] {
  const refs: MediaRef[] = [];
  const snapshot = (candidate: MediaSnapshot, sprite: boolean) => {
    refs.push({ url: candidate.url, sprite, replace(media) {
      const { url, storageKey, width, height, format } = media;
      Object.assign(candidate, { url, storageKey, width, height, format, candidateId: randomUUID() });
    } });
  };
  for (const images of [bundle.spec.authoring?.stageImages, bundle.spec.authoring?.portraitImages]) {
    for (const image of Object.values(images ?? {})) {
      if (image.type === "candidate") snapshot(image.candidate, false);
      else if (image.type === "legacy" && image.url) refs.push({ url: image.url, sprite: false, replace(media) { image.url = media.url; image.version = 1; } });
    }
  }
  for (const sprite of Object.values(bundle.spec.authoring?.walkingSprites ?? {})) {
    if (sprite.type === "custom") snapshot(sprite.candidate, true);
  }
  return refs;
}

export async function createSpecArchive(bundle: SpecBundle, download: (url: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const json = strToU8(JSON.stringify(bundle, null, 2) + "\n");
  if (json.length > MAX_SPEC_BYTES) throw Error("Adventure JSON exceeds the 10 MB limit.");
  const files: Record<string, Uint8Array> = { "adventure.json": json };
  const manifest: z.infer<typeof Manifest> = [];
  let total = json.length;
  for (const url of new Set(mediaRefs(bundle).map((ref) => ref.url))) {
    if (manifest.length >= MAX_ENTRIES - 2) throw Error("Too many assets for one ZIP.");
    const bytes = await download(url);
    if (!bytes.length || bytes.length > MAX_SPEC_BYTES) throw Error("An asset is empty or exceeds 10 MB.");
    total += bytes.length;
    if (total > MAX_EXPANDED_BYTES) throw Error("Expanded archive exceeds the 40 MB limit.");
    const path = `assets/${manifest.length}.bin`;
    files[path] = bytes;
    manifest.push({ url, path });
  }
  files["assets.json"] = strToU8(JSON.stringify(manifest));
  const zip = zipSync(files, { level: 0 });
  if (zip.length > MAX_ARCHIVE_BYTES) throw Error("ZIP exceeds 15 MB. Export JSON instead or reduce the selected assets.");
  return zip;
}

export type SpecArchive = { bundle: SpecBundle; media: Map<string, { image?: NormalizedMedia; sprite?: NormalizedMedia }> };

export async function readSpecArchive(bytes: Uint8Array): Promise<SpecArchive> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw Error("Choose a ZIP smaller than 15 MB.");
  let count = 0, total = 0;
  const paths = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter(file) {
      if (++count > MAX_ENTRIES || file.originalSize > MAX_SPEC_BYTES || (total += file.originalSize) > MAX_EXPANDED_BYTES) throw Error("ZIP expanded size or file count exceeds the limit.");
      if (paths.has(file.name)) throw Error("Duplicate ZIP paths are not supported.");
      paths.add(file.name);
      if (!["adventure.json", "assets.json"].includes(file.name) && !/^assets\/[0-9]+\.bin$/.test(file.name)) throw Error("Unsupported ZIP path. Use an exported adventure ZIP with adventure.json.");
      return true;
    } });
  } catch (error) {
    throw Error(error instanceof Error ? `Could not read ZIP: ${error.message}` : "Could not read ZIP.");
  }
  if (!files["adventure.json"]) throw Error("ZIP must contain adventure.json at its root.");
  const bundle = parseSpecImport(strFromU8(files["adventure.json"]));
  const manifest = Manifest.parse(files["assets.json"] ? JSON.parse(strFromU8(files["assets.json"])) : []);
  const media: SpecArchive["media"] = new Map();
  const refs = mediaRefs(bundle);
  const usedPaths = new Set<string>();
  for (const entry of manifest) {
    if (media.has(entry.url) || usedPaths.has(entry.path)) throw Error("Duplicate assets in ZIP manifest.");
    usedPaths.add(entry.path);
    const data = files[entry.path];
    const targets = refs.filter((ref) => ref.url === entry.url);
    if (!data || !targets.length) throw Error("ZIP asset is missing or does not match the adventure.");
    const normalized: { image?: NormalizedMedia; sprite?: NormalizedMedia } = {};
    if (targets.some((ref) => ref.sprite)) normalized.sprite = await validateSpriteUpload(data);
    if (targets.some((ref) => !ref.sprite)) normalized.image = await normalizeImageUpload(data);
    media.set(entry.url, normalized);
  }
  if (Object.keys(files).some((path) => path.startsWith("assets/") && !usedPaths.has(path))) throw Error("ZIP contains unlisted assets.");
  // A JSON-only ZIP is also supported, retaining its existing URL references.
  if (files["assets.json"] && refs.some((ref) => !media.has(ref.url))) throw Error("ZIP is missing selected media.");
  return { bundle, media };
}

export async function restoreArchiveMedia(archive: SpecArchive, id: string, put: (key: string, bytes: Uint8Array, mimeType: string) => Promise<string>): Promise<SpecBundle> {
  const bundle = structuredClone(archive.bundle);
  const uploaded = new Map<string, NormalizedMedia & { url: string; storageKey: string }>();
  for (const ref of mediaRefs(bundle)) {
    const normalized = archive.media.get(ref.url)?.[ref.sprite ? "sprite" : "image"];
    if (!normalized) continue;
    const cacheKey = `${ref.sprite}:${ref.url}`;
    let media = uploaded.get(cacheKey);
    if (!media) {
      const storageKey = `v3/imports/${id}/${randomUUID()}.${normalized.format}`;
      const url = await put(storageKey, normalized.bytes, `image/${normalized.format}`);
      media = { ...normalized, url, storageKey };
      uploaded.set(cacheKey, media);
    }
    ref.replace(media);
  }
  return bundle;
}
