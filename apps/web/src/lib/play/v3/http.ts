import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { createOpenAiClient } from "@adventure/orchestration";
import type { LlmClient } from "@adventure/orchestration";

import { createAdminClient } from "@/lib/supabase/admin";
import { withPlayUsageV3, withPreviewUsageV3 } from "@/lib/usage/ledger";

import type { V3PreviewDeps } from "./preview";
import type { V3PublishDeps } from "./publish";
import type { V3SummaryDeps } from "./summary";
import type { V3PlayServiceDeps } from "./service";
import { SupabaseV3PlayStore } from "./store";

let deps: V3PlayServiceDeps | null = null;
let previewDeps: V3PreviewDeps | null = null;
let summaryDeps: V3SummaryDeps | null = null;
let publishDeps: V3PublishDeps | null = null;

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

export function v3PreviewDeps(): V3PreviewDeps {
  if (!previewDeps) {
    const baseLlm: LlmClient = createOpenAiClient();
    previewDeps = {
      store: new SupabaseV3PlayStore(createAdminClient()),
      llm: (context) => withPreviewUsageV3(baseLlm, context),
      now: () => Date.now(),
      env: process.env,
    };
  }
  return previewDeps;
}

export function v3SummaryDeps(): V3SummaryDeps {
  if (!summaryDeps) {
    summaryDeps = {
      store: new SupabaseV3PlayStore(createAdminClient()),
      env: process.env,
    };
  }
  return summaryDeps;
}

export function v3PublishDeps(): V3PublishDeps {
  if (!publishDeps) {
    publishDeps = {
      sources: async id => (await supabaseV3SourceStore(createAdminClient).load(id)).map(d => ({ id: d.id, title: d.title, text: d.pages.map(p => p.text).join("\n") })),
      store: new SupabaseV3PlayStore(createAdminClient()),
      env: process.env,
    };
  }
  return publishDeps;
}
