import { estimateCostUsd, PendingResponseError } from "@adventure/generation/llm";
import type { LlmClient as GenerationLlmClient, LlmJsonRequest, LlmJsonResponse } from "@adventure/generation/llm";
import type { LlmClient as PlayLlmClient, LlmRequest, LlmResponse } from "@adventure/orchestration";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { withJsonUsage, withPlayUsage } from "@/lib/usage/ledger";

const { createAdminClient, insert } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient,
}));

const jsonRequest: LlmJsonRequest = {
  model: "gpt-5.4",
  system: "system",
  user: "user",
  schemaName: "adventure_plan",
  jsonSchema: {},
  maxOutputTokens: 100,
  reasoningEffort: null,
};

const jsonResponse: LlmJsonResponse = {
  text: "{}",
  json: {},
  refusal: null,
  usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningTokens: 5 },
  model: "gpt-5.4",
  latencyMs: 20,
};

const playRequest: LlmRequest = {
  modelTier: "mid",
  model: "gpt-5.4-mini",
  system: "system",
  user: "user",
  schemaName: "character_reply",
  jsonSchema: {},
};

const playResponse: LlmResponse = {
  content: "{}",
  usage: { promptTokens: 80, cachedPromptTokens: 30, completionTokens: 15, reasoningTokens: 4 },
  latencyMs: 10,
};

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  createAdminClient.mockReset().mockImplementation(() => ({ from: vi.fn(() => ({ insert })) }));
});

describe("withJsonUsage", () => {
  it("records mapped usage and returns the original response", async () => {
    const client: GenerationLlmClient = { completeJson: vi.fn().mockResolvedValue(jsonResponse) };
    const wrapped = withJsonUsage(client, { purpose: "brief", adventureId: "adventure-1", userId: "user-1" });

    await expect(wrapped.completeJson(jsonRequest)).resolves.toBe(jsonResponse);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "brief",
      call: "adventure_plan",
      model: "gpt-5.4",
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 20,
      reasoning_tokens: 5,
      cost_usd: estimateCostUsd("gpt-5.4", jsonResponse.usage),
      adventure_id: "adventure-1",
      user_id: "user-1",
    }));
  });

  it("swallows an insert failure", async () => {
    const client: GenerationLlmClient = { completeJson: vi.fn().mockResolvedValue(jsonResponse) };
    const wrapped = withJsonUsage(client, { purpose: "generation", adventureId: "adventure-1", userId: "user-1" });
    const error = new Error("database unavailable");
    insert.mockResolvedValue({ error });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(wrapped.completeJson(jsonRequest)).resolves.toBe(jsonResponse);
    expect(log).toHaveBeenCalledWith("could not record LLM usage", error);
    log.mockRestore();
  });

  it("swallows an admin client construction failure", async () => {
    const client: GenerationLlmClient = { completeJson: vi.fn().mockResolvedValue(jsonResponse) };
    const wrapped = withJsonUsage(client, { purpose: "generation", adventureId: "adventure-1", userId: "user-1" });
    const error = new Error("service key unavailable");
    createAdminClient.mockImplementation(() => {
      throw error;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(wrapped.completeJson(jsonRequest)).resolves.toBe(jsonResponse);
    expect(insert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("could not record LLM usage", error);
    log.mockRestore();
  });

  it("does not record and rethrows a pending response error", async () => {
    const error = new PendingResponseError("response-1");
    const client: GenerationLlmClient = { completeJson: vi.fn().mockRejectedValue(error) };
    const wrapped = withJsonUsage(client, { purpose: "generation", adventureId: "adventure-1", userId: "user-1" });

    await expect(wrapped.completeJson(jsonRequest)).rejects.toBe(error);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("withPlayUsage", () => {
  it("maps orchestration usage and returns the original response", async () => {
    const client: PlayLlmClient = { complete: vi.fn().mockResolvedValue(playResponse) };
    const wrapped = withPlayUsage(client, "attempt-1");

    await expect(wrapped.complete(playRequest)).resolves.toBe(playResponse);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "play",
      call: "character_reply",
      model: "gpt-5.4-mini",
      attempt_id: "attempt-1",
      input_tokens: 80,
      cached_input_tokens: 30,
      output_tokens: 15,
      reasoning_tokens: 4,
      cost_usd: estimateCostUsd("gpt-5.4-mini", {
        inputTokens: 80,
        cachedInputTokens: 30,
        outputTokens: 15,
        reasoningTokens: 4,
      }),
    }));
  });

  it("swallows an insert failure", async () => {
    const client: PlayLlmClient = { complete: vi.fn().mockResolvedValue(playResponse) };
    const wrapped = withPlayUsage(client, "attempt-1");
    const error = new Error("database unavailable");
    insert.mockResolvedValue({ error });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(wrapped.complete(playRequest)).resolves.toBe(playResponse);
    expect(log).toHaveBeenCalledWith("could not record LLM usage", error);
    log.mockRestore();
  });

  it("does not record and rethrows a client error", async () => {
    const error = new Error("model request failed");
    const client: PlayLlmClient = { complete: vi.fn().mockRejectedValue(error) };
    const wrapped = withPlayUsage(client, "attempt-1");

    await expect(wrapped.complete(playRequest)).rejects.toBe(error);
    expect(insert).not.toHaveBeenCalled();
  });
});
