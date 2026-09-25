/**
 * Opt-in per-call cost log for measuring what one attempt costs (M6 pricing).
 *
 * `attempt_telemetry.tokens` only sums character replies and stores one total,
 * so it can't be priced. This wraps the play client and appends one JSON line
 * per model call — attempt, call type, model, and the input/cached/output split
 * each model is billed on. Off unless `PLAY_COST_LOG=1`; summarise the file with
 * `node scripts/play-cost-summary.mjs`.
 */
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

import type { LlmClient } from "@adventure/orchestration";

export const PLAY_COST_FILE = join(process.cwd(), "play-cost.jsonl");

export function costMeterEnabled(): boolean {
  return process.env.PLAY_COST_LOG === "1";
}

export function meteredClient(client: LlmClient, attemptId: string, file = PLAY_COST_FILE): LlmClient {
  return {
    async complete(request) {
      let response: Awaited<ReturnType<LlmClient["complete"]>>;
      try {
        response = await client.complete(request);
      } catch (error) {
        // Callers often swallow model errors and fall back silently; the log is where they show up.
        const failed = { at: new Date().toISOString(), attemptId, call: request.schemaName, tier: request.modelTier, model: request.model ?? null, error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
        await appendFile(file, `${JSON.stringify(failed)}\n`).catch(() => undefined);
        throw error;
      }
      const line = {
        at: new Date().toISOString(),
        attemptId,
        call: request.schemaName,
        tier: request.modelTier,
        model: response.model ?? request.model ?? null,
        inputTokens: response.usage.promptTokens,
        cachedInputTokens: response.usage.cachedPromptTokens ?? 0,
        outputTokens: response.usage.completionTokens,
        reasoningTokens: response.usage.reasoningTokens ?? 0,
        latencyMs: response.latencyMs ?? null,
        serviceTier: response.serviceTier ?? null,
      };
      // Measurement must never break play: a failed write is reported and dropped.
      await appendFile(file, `${JSON.stringify(line)}\n`).catch((error) => console.error("[play-cost] could not write", error));
      return response;
    },
  };
}
