import { describe, expect, it } from "vitest";
import type { LlmClient, LlmJsonRequest } from "@adventure/generation/llm";
import { proposeRequestedChanges } from "../../apps/web/src/lib/v3/review-chat/propose";

describe("natural prose in teacher chat", () => {
  it("passes writing guidance to chat while retaining evidence and quotation safeguards", async () => {
    let sent: LlmJsonRequest | undefined;
    const llm: LlmClient = {
      async completeJson(request) {
        sent = request;
        const json = { notes: "Shorten the title.", changes: [{ path: ["title"], value_json: JSON.stringify("Wireless repairs") }] };
        return { json, text: JSON.stringify(json), refusal: null, model: request.model, latencyMs: 0,
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } };
      },
    };
    const result = await proposeRequestedChanges({ llm }, {
      text: "Make this title sound like an ordinary note.", subject: "stage", roots: ["title"],
      current: { title: "Illustrative wireless repairs note" }, validate: async () => [],
    });
    expect(result.ok).toBe(true);
    expect(sent?.system).toContain("Source status belongs in metadata shown by the interface");
    expect(sent?.system).toContain("Preserve historical quotations exactly");
    expect(sent?.system).toContain("Uploaded evidence is fixed");
    expect(sent?.system).toContain("Do not change IDs, references, citations, source labels, historical/invented classifications");
    expect(sent?.system).not.toContain("$humanizer");
  });
});
