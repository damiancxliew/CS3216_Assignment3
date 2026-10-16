import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmClient as GenerationLlmClient } from "@adventure/generation/llm";
import type { LlmClient as PlayLlmClient } from "@adventure/orchestration";

import { createAdminClient } from "@/lib/supabase/admin";

type UsagePurpose = "brief" | "generation" | "play";

type UsageTokens = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type UsageRow = UsageTokens & {
  purpose: UsagePurpose;
  call: string;
  model: string | null;
  attemptId?: string;
  attemptV3Id?: string;
  adventureV3Id?: string;
  adventureId?: string;
  organizationId?: string;
  userId?: string | null;
};

type JsonUsageContext = Pick<UsageRow, "adventureId" | "adventureV3Id" | "organizationId" | "userId"> & {
  purpose: "brief" | "generation";
};

export async function recordLlmUsage(getAdmin: () => SupabaseClient, row: UsageRow): Promise<void> {
  try {
    const { error } = await getAdmin().from("llm_usage").insert({
      purpose: row.purpose,
      call: row.call,
      model: row.model,
      input_tokens: row.inputTokens,
      cached_input_tokens: row.cachedInputTokens,
      output_tokens: row.outputTokens,
      reasoning_tokens: row.reasoningTokens,
      attempt_id: row.attemptId,
      ...(row.attemptV3Id === undefined ? {} : { attempt_v3_id: row.attemptV3Id }),
      ...(row.adventureV3Id === undefined ? {} : { adventure_v3_id: row.adventureV3Id }),
      adventure_id: row.adventureId,
      organization_id: row.organizationId,
      user_id: row.userId,
    });
    if (error) console.error("could not record LLM usage", error);
  } catch (error) {
    console.error("could not record LLM usage", error);
  }
}

export function withJsonUsage(
  client: GenerationLlmClient,
  context: JsonUsageContext,
): GenerationLlmClient {
  return {
    async completeJson(request) {
      const response = await client.completeJson(request);
      await recordLlmUsage(createAdminClient, {
        ...context,
        call: request.schemaName,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        cachedInputTokens: response.usage.cachedInputTokens,
        outputTokens: response.usage.outputTokens,
        reasoningTokens: response.usage.reasoningTokens,
      });
      return response;
    },
  };
}

export function withPlayUsage(client: PlayLlmClient, attemptId: string): PlayLlmClient {
  return {
    async complete(request) {
      const response = await client.complete(request);
      await recordLlmUsage(createAdminClient, {
        purpose: "play",
        call: request.schemaName,
        model: response.model ?? request.model ?? null,
        attemptId,
        inputTokens: response.usage.promptTokens,
        cachedInputTokens: response.usage.cachedPromptTokens ?? 0,
        outputTokens: response.usage.completionTokens,
        reasoningTokens: response.usage.reasoningTokens ?? 0,
      });
      return response;
    },
  };
}

export function withPlayUsageV3(
  client: PlayLlmClient,
  context: { attemptId: string; organizationId: string; userId: string },
): PlayLlmClient {
  return {
    async complete(request) {
      const response = await client.complete(request);
      await recordLlmUsage(createAdminClient, {
        purpose: "play",
        call: request.schemaName,
        model: response.model ?? request.model ?? null,
        attemptV3Id: context.attemptId,
        organizationId: context.organizationId,
        userId: context.userId,
        inputTokens: response.usage.promptTokens,
        cachedInputTokens: response.usage.cachedPromptTokens ?? 0,
        outputTokens: response.usage.completionTokens,
        reasoningTokens: response.usage.reasoningTokens ?? 0,
      });
      return response;
    },
  };
}

export function withPreviewUsageV3(
  client: PlayLlmClient,
  context: { organizationId: string; userId: string },
): PlayLlmClient {
  return {
    async complete(request) {
      const response = await client.complete(request);
      await recordLlmUsage(createAdminClient, {
        purpose: "play",
        call: `preview:${request.schemaName}`,
        model: response.model ?? request.model ?? null,
        organizationId: context.organizationId,
        userId: context.userId,
        inputTokens: response.usage.promptTokens,
        cachedInputTokens: response.usage.cachedPromptTokens ?? 0,
        outputTokens: response.usage.completionTokens,
        reasoningTokens: response.usage.reasoningTokens ?? 0,
      });
      return response;
    },
  };
}
