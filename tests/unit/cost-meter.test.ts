import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { LlmClient } from "@adventure/orchestration";

import { meteredClient } from "@/lib/play/cost-meter";

const request = { modelTier: "mid", system: "s", user: "u", schemaName: "character_turn", jsonSchema: {} } as const;

describe("play cost meter", () => {
  it("logs each call against its attempt with the billed token split", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "play-cost-")), "log.jsonl");
    const inner: LlmClient = {
      complete: async () => ({ content: "{}", model: "gpt-6-luna-2026", latencyMs: 12, usage: { promptTokens: 900, cachedPromptTokens: 600, completionTokens: 80, reasoningTokens: 20 } }),
    };
    const client = meteredClient(inner, "attempt-1", file);

    const response = await client.complete(request);
    await client.complete({ ...request, schemaName: "room_reply_route" });

    expect(response.content).toBe("{}");
    const lines = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.call)).toEqual(["character_turn", "room_reply_route"]);
    expect(lines[0]).toMatchObject({ attemptId: "attempt-1", model: "gpt-6-luna-2026", inputTokens: 900, cachedInputTokens: 600, outputTokens: 80, reasoningTokens: 20 });
  });

  it("logs a failed call, then rethrows so the caller's fallback still runs", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "play-cost-")), "log.jsonl");
    const inner: LlmClient = { complete: async () => { throw new Error("400 Unsupported parameter"); } };
    await expect(meteredClient(inner, "attempt-1", file).complete({ ...request, schemaName: "option_minting", model: "gpt-6-sol" })).rejects.toThrow("Unsupported");
    const [line] = (await readFile(file, "utf8")).trim().split("\n").map((entry) => JSON.parse(entry));
    expect(line).toMatchObject({ attemptId: "attempt-1", call: "option_minting", model: "gpt-6-sol", error: "400 Unsupported parameter" });
  });

  it("never fails a call because the log can't be written", async () => {
    const inner: LlmClient = { complete: async () => ({ content: "ok", usage: { promptTokens: 1, completionTokens: 1 } }) };
    const client = meteredClient(inner, "attempt-1", join(tmpdir(), "missing-dir", "nested", "log.jsonl"));
    await expect(client.complete(request)).resolves.toMatchObject({ content: "ok" });
  });
});
