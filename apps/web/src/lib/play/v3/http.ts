import { createOpenAiClient } from "@adventure/orchestration";
import type { LlmClient } from "@adventure/orchestration";

import { createAdminClient } from "@/lib/supabase/admin";
import { withPlayUsageV3 } from "@/lib/usage/ledger";

import type { V3PlayServiceDeps } from "./service";
import { SupabaseV3PlayStore } from "./store";

let deps: V3PlayServiceDeps | null = null;

export function v3PlayDeps(): V3PlayServiceDeps {
  if (!deps) {
    const baseLlm: LlmClient = createOpenAiClient();
    deps = {
      store: new SupabaseV3PlayStore(createAdminClient()),
      llm: (context) => withPlayUsageV3(baseLlm, context),
      now: () => Date.now(),
      env: process.env,
    };
  }
  return deps;
}
