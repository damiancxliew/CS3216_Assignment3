import { OpenAiLlmClient, type LlmClient } from "@adventure/generation/llm";
import { withJsonUsage } from "@/lib/usage/ledger";
import { fakeEditFixer } from "./ai-fix";

export function editFixLlm(adventureV3Id: string, schoolId: string, userId: string): LlmClient {
  if (process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production") return fakeEditFixer();
  return withJsonUsage(new OpenAiLlmClient({ timeoutMs: 240_000, maxRetries: 0 }), {
    purpose: "generation", adventureV3Id, organizationId: schoolId, userId,
  });
}
