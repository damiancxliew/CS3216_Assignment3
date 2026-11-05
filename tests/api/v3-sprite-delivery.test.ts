import { afterEach, describe, expect, it, vi } from "vitest";
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/assets/store", () => ({ createAssetStore: () => ({ download }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
import { GET } from "@/app/api/v3/sprites/[...path]/route";
import { spriteObjectKey, spritePresentationUrl } from "@/lib/play/v3/sprite-url";

const path = `00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/${"a".repeat(64)}.png`;
const base = "https://cdn.example.test";
const request = (value: string) => GET(new Request(`https://app.example.test/api/v3/sprites/${value}`), { params: Promise.resolve({ path: value.split("/") }) });
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("same-origin sprite delivery", () => {
  it("projects only stored media on the configured asset host and leaves the saved URL intact", () => {
    const url = `${base}/v3/media/${path}`;
    expect(spritePresentationUrl(url, base)).toBe(`/api/v3/sprites/${path}`);
    expect(spritePresentationUrl(url, `${base}/`)).toBe(`/api/v3/sprites/${path}`);
    expect(spritePresentationUrl(url, "https://other.example.test")).toBe(url);
    expect(spritePresentationUrl(`${base}.evil.example/v3/media/${path}`, base)).toContain(".evil.example");
    expect(spritePresentationUrl("/game/ninja/characters/Boy/walk.png", base)).toBe("/game/ninja/characters/Boy/walk.png");
    expect(spriteObjectKey(`../${path}`)).toBeNull();
  });
  it("returns the stored PNG bytes with immutable caching and no redirects to the CDN", async () => {
    vi.stubEnv("ASSET_BUCKET", "test"); vi.stubEnv("ASSET_PUBLIC_BASE_URL", base);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    download.mockResolvedValue(bytes);
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(download).toHaveBeenCalledWith(`${base}/v3/media/${path}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("location")).toBeNull();
  });
  it("rejects arbitrary URLs and paths without touching storage", async () => {
    vi.stubEnv("ASSET_BUCKET", "test"); vi.stubEnv("ASSET_PUBLIC_BASE_URL", base);
    for (const value of ["https://127.0.0.1/secret", `../${path}`, path.replace(".png", ".svg"), "v3/portraits/secret.png"]) {
      const response = await request(value);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: "Sprite not found." } });
    }
    expect(download).not.toHaveBeenCalled();
  });
  it("does not cache storage failures as images", async () => {
    vi.stubEnv("ASSET_BUCKET", "test"); vi.stubEnv("ASSET_PUBLIC_BASE_URL", base);
    download.mockRejectedValue(Error("private storage detail"));
    const response = await request(path);
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "asset_unavailable", message: "Sprite unavailable." } });
  });
  it("returns uncached JSON errors for missing and oversized stored images", async () => {
    vi.stubEnv("ASSET_BUCKET", "test"); vi.stubEnv("ASSET_PUBLIC_BASE_URL", base);
    download.mockResolvedValueOnce(null).mockResolvedValueOnce(new Uint8Array(10 * 1024 * 1024 + 1));
    for (const status of [404, 502]) {
      const response = await request(path);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toHaveProperty("error.code", status === 404 ? "not_found" : "asset_unavailable");
    }
  });
});
