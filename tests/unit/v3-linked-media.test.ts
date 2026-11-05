import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { AdventureSpec, type MediaSnapshot } from "@adventure/spec-v3";
import { validateLinkedMedia } from "@/lib/v3/spec-archive";
import { MAX_SPEC_BYTES, specExport } from "@/lib/v3/spec-transfer";

const png = new Uint8Array(readFileSync("apps/web/public/game/ninja/characters/Noble/walk.png"));
const fixture = () => {
  const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
  spec.authoring = {};
  return specExport(spec, [], "original", 1);
};
const snapshot = (url: string): MediaSnapshot => ({
  candidateId: "00000000-0000-4000-8000-000000000001", origin: "upload", url,
  format: "png", caption: "Artwork", alt: "Artwork", credit: "Artist",
  sourceUrl: "https://example.test/attribution", licence: { label: "CC BY", url: "https://example.test/licence" },
});

function withMedia(kind: "stage" | "portrait" | "sprite") {
  const bundle = fixture();
  if (kind === "stage") bundle.spec.authoring!.stageImages = { stage: { type: "legacy", version: 1, url: "https://example.test/art.png" } };
  if (kind === "portrait") bundle.spec.authoring!.portraitImages = { portrait: { type: "candidate", candidate: snapshot("https://example.test/art.png") } };
  if (kind === "sprite") bundle.spec.authoring!.walkingSprites = { player: { type: "custom", fallback: "Noble", candidate: snapshot("https://example.test/sprite.png") } };
  return bundle;
}

describe("linked import media", () => {
  it("validates unique selected media, skips fallback/bundled assets and attribution, and preserves JSON", async () => {
    const bundle = withMedia("stage");
    bundle.spec.authoring!.portraitImages = {
      portrait: { type: "candidate", candidate: snapshot("https://example.test/art.png") },
      fallback: { type: "fallback" }, empty: { type: "legacy", version: 1, url: null },
    };
    bundle.spec.authoring!.walkingSprites = {
      player: { type: "custom", fallback: "Noble", candidate: snapshot("https://example.test/sprite.png") },
      character: { type: "custom", fallback: "Noble", candidate: snapshot("https://example.test/sprite.png") },
      bundled: { type: "bundled", bundledId: "Noble", fallback: "Noble" },
    };
    bundle.sources = [{ id: "reading", title: "Reading", kind: "text", origin: "outside", url: "https://example.test/source", pages: [] }];
    const original = structuredClone(bundle);
    const requested: string[] = [];
    const download = vi.fn(async (url: string) => { requested.push(url); return png; });
    await validateLinkedMedia(bundle, download);
    expect(download.mock.calls).toHaveLength(2);
    expect(requested).toEqual(["https://example.test/art.png", "https://example.test/sprite.png"]);
    expect(bundle).toEqual(original);
  });

  it.each(["stage", "portrait", "sprite"] as const)("identifies unavailable %s media", async (kind) => {
    await expect(validateLinkedMedia(withMedia(kind), async () => { throw Error("404"); })).rejects.toThrow(kind);
  });

  it("rejects an HTML response with a successful status", async () => {
    await expect(validateLinkedMedia(withMedia("stage"), async () => new TextEncoder().encode("<html>Not an image</html>"))).rejects.toThrow("stage image");
  });

  it("validates a shared URL as both an image and a custom sprite", async () => {
    const bundle = withMedia("stage");
    bundle.spec.authoring!.walkingSprites = { player: { type: "custom", fallback: "Noble", candidate: snapshot("https://example.test/art.png") } };
    const rectangular = new Uint8Array(await sharp(png).resize(96, 64).png().toBuffer());
    const download = vi.fn(async () => rectangular);
    await expect(validateLinkedMedia(bundle, download)).rejects.toThrow('sprite "player"');
    expect(download).toHaveBeenCalledOnce();
  });

  it.each([0, MAX_SPEC_BYTES + 1])("rejects a %i-byte asset", async (size) => {
    await expect(validateLinkedMedia(withMedia("stage"), async () => new Uint8Array(size))).rejects.toThrow("stage image");
  });

  it("rejects more than 198 unique media URLs before downloading", async () => {
    const bundle = fixture();
    bundle.spec.authoring!.stageImages = Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`stage-${i}`, { type: "legacy" as const, version: 1, url: `https://example.test/${i}.png` }]));
    const download = vi.fn(async () => png);
    await expect(validateLinkedMedia(bundle, download)).rejects.toThrow("198");
    expect(download).not.toHaveBeenCalled();
  });

  it("bounds the total downloaded media to 40 MB", async () => {
    const bundle = fixture();
    bundle.spec.authoring!.stageImages = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`stage-${i}`, { type: "legacy" as const, version: 1, url: `https://example.test/${i}.png` }]));
    const padded = new Uint8Array(MAX_SPEC_BYTES); padded.set(png);
    const download = vi.fn(async () => padded);
    await expect(validateLinkedMedia(bundle, download)).rejects.toThrow("40 MB");
    expect(download).toHaveBeenCalledTimes(5);
  });

  it("times out stalled media reads and aborts the downloader", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    try {
      const validation = validateLinkedMedia(withMedia("stage"), async (_url, receivedSignal) => {
        signal = receivedSignal;
        return new Promise<Uint8Array>(() => {});
      });
      const failure = expect(validation).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30_000);
      await failure;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("accepts adventures without selected external media without downloading", async () => {
    const download = vi.fn(async () => png);
    await validateLinkedMedia(fixture(), download);
    expect(download).not.toHaveBeenCalled();
  });
});
