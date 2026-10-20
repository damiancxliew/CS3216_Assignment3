import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { reviewAssets } from "@/lib/v3/review-assets";

const fixture = () => AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
afterEach(() => vi.unstubAllEnvs());

describe("generated asset inventory", () => {
  it("uses the saved version's stage art and every generated character expression", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example");
    vi.stubEnv("ASSET_BUCKET", "");
    const spec = fixture();
    const assets = reviewAssets(spec, "adventure", 3);
    expect(assets.filter((asset) => asset.kind === "stage")).toHaveLength(spec.stages.length);
    expect(assets[0].url).toBe("https://storage.example/storage/v1/object/public/assets/v3/stage-art/adventure/v3/stage-0.webp");
    expect(assets.filter((asset) => asset.kind === "portrait")).toHaveLength(
      spec.characters.reduce((count, character) => count + (character.tier === "major" ? character.stances.length : 1), 0),
    );
  });
  it("resolves inherited portraits and leaves invalidated portraits unavailable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example");
    vi.stubEnv("ASSET_BUCKET", "");
    const spec = fixture();
    const character = spec.characters.find((character) => character.tier === "major")!;
    const first = `${character.id}:${character.stances[0].id}`;
    const second = `${character.id}:${character.stances[1].id}`;
    spec.authoring = { portraitVersions: { [first]: 1, [second]: null } };
    const assets = reviewAssets(spec, "adventure", 3);
    expect(assets.find((asset) => asset.id === first)).toMatchObject({ version: 1, url: expect.stringContaining("/v1/") });
    expect(assets.find((asset) => asset.id === second)).toMatchObject({ version: null, url: null });
  });
});
