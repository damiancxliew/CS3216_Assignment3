import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  edit: vi.fn(async (_request: Record<string, unknown>) => ({ data: [{ b64_json: Buffer.from("edited portrait").toString("base64") }] })),
  generate: vi.fn(async () => ({ data: [{ b64_json: Buffer.from("new portrait").toString("base64") }] })),
}));
vi.mock("openai", async importOriginal => {
  const original = await importOriginal<typeof import("openai")>();
  return { ...original, default: class { images = calls; } };
});
import { OpenAiImageService } from "@adventure/generation/assets";

describe("portrait image adapter", () => {
  it("sends original portrait bytes to the edits endpoint and keeps text-only generation working", async () => {
    const images = new OpenAiImageService({ apiKey: "fixture", model: "gpt-image-1-mini" });
    const request = { kind: "portrait" as const, prompt: "Preserve identity; change expression", size: "1024x1024" as const, quality: "medium" as const };
    const bytes = new Uint8Array([1, 2, 3]);
    const edited = await images.generate({ ...request, referenceImage: { bytes, mimeType: "image/webp" } });
    expect(calls.edit).toHaveBeenCalledTimes(1);
    expect(calls.generate).not.toHaveBeenCalled();
    const file = calls.edit.mock.calls[0][0].image as File;
    expect(file.type).toBe("image/webp");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(edited.bytes).toEqual(new Uint8Array(Buffer.from("edited portrait")));
    await images.generate(request);
    expect(calls.generate).toHaveBeenCalledTimes(1);
  });
});
