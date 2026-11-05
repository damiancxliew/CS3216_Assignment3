import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync, unzipSync } from "fflate";
import { AdventureSpec } from "@adventure/spec-v3";
import { createSpecArchive, readSpecArchive, restoreArchiveMedia } from "@/lib/v3/spec-archive";
import { specExport } from "@/lib/v3/spec-transfer";

const fixture = () => {
  const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
  spec.authoring = { stageImages: { [spec.stages[0].id]: { type: "legacy", version: 1, url: "https://old.test/stage.png" } } };
  return specExport(spec, [], "original", 1);
};
const png = readFileSync("apps/web/public/game/ninja/characters/Noble/walk.png");

describe("portable v3 ZIP archives", () => {
  it("includes JSON and image bytes, then restores them to new storage", async () => {
    const bundle = fixture();
    const zip = await createSpecArchive(bundle, async () => png);
    const archive = await readSpecArchive(zip);
    expect(archive.bundle.spec.title).toBe(bundle.spec.title);
    expect(Object.keys(unzipSync(zip))).toContain("adventure.json");
    const writes: string[] = [];
    const restored = await restoreArchiveMedia(archive, "new-copy", async (key) => { writes.push(key); return `https://new.test/${key}`; });
    const image = restored.spec.authoring!.stageImages![bundle.spec.stages[0].id];
    expect(image.type).toBe("legacy");
    expect(image.type === "legacy" && image.url).toContain("https://new.test/v3/imports/new-copy/");
    expect(writes).toHaveLength(1);
    expect(JSON.stringify(restored.spec)).not.toContain("https://old.test/");
  });

  it("accepts a ZIP with just adventure.json", async () => {
    const bundle = fixture();
    const archive = await readSpecArchive(zipSync({ "adventure.json": strToU8(JSON.stringify(bundle)) }));
    expect(archive.bundle).toEqual(bundle);
  });

  it("restores custom walking sprites without resizing the sheet or losing attribution", async () => {
    const bundle = fixture();
    bundle.spec.authoring!.walkingSprites = { player: { type: "custom", fallback: "Noble", candidate: {
      candidateId: "00000000-0000-4000-8000-000000000001", origin: "upload", url: "https://old.test/sprite.png", format: "png", caption: "Player", alt: "Player sprite", credit: "Artist", spriteLayout: "4x4-down-up-left-right",
    } } };
    const archive = await readSpecArchive(await createSpecArchive(bundle, async () => png));
    const restored = await restoreArchiveMedia(archive, "new-copy", async (key) => `https://new.test/${key}`);
    const sprite = restored.spec.authoring!.walkingSprites!.player;
    expect(sprite.type).toBe("custom");
    if (sprite.type !== "custom") throw Error("Expected custom sprite");
    expect(sprite.candidate.url).toContain("https://new.test/");
    expect(sprite.candidate.credit).toBe("Artist");
    expect(sprite.candidate.spriteLayout).toBe("4x4-down-up-left-right");
    expect(sprite.candidate.format).toBe("png");
    expect(AdventureSpec.safeParse(restored.spec).success).toBe(true);
  });

  it("fails export when a selected image cannot be downloaded", async () => {
    await expect(createSpecArchive(fixture(), async () => { throw Error("unavailable"); })).rejects.toThrow(/unavailable/);
  });

  it.each(["../escape.png", "/absolute.png", "assets/../../escape.png"])("rejects unsafe archive paths: %s", async (path) => {
    await expect(readSpecArchive(zipSync({ "adventure.json": strToU8(JSON.stringify(fixture())), [path]: png }))).rejects.toThrow(/path|unsupported/i);
  });

  it("rejects an archive without adventure.json", async () => {
    await expect(readSpecArchive(zipSync({ "other.json": strToU8("{}") }))).rejects.toThrow(/adventure.json/);
  });

  it("rejects oversized expanded entries before decoding", async () => {
    const zip = zipSync({ "adventure.json": new Uint8Array(10 * 1024 * 1024 + 1) });
    await expect(readSpecArchive(zip)).rejects.toThrow(/large|limit/i);
  });

  it("rejects malformed ZIP and invalid image data", async () => {
    await expect(readSpecArchive(strToU8("not a zip"))).rejects.toThrow();
    const zip = await createSpecArchive(fixture(), async () => strToU8("not an image"));
    await expect(readSpecArchive(zip)).rejects.toThrow(/decode|image/i);
  });
});
