import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  commitRuntimeDecision,
  postRuntimeMessage,
  runtimeState,
  type CommitDecisionResult,
  type PostMessageResult,
} from "./runtime";
import {
  SupabaseRuntimeStore,
} from "./supabase-runtime";
import type { PublicAttemptState } from "./contract";

export interface TurnRuntimeBackend {
  getState(attemptId: string): Promise<PublicAttemptState>;
  postMessage(attemptId: string, roomId: string, body: string): Promise<PostMessageResult>;
  commitDecision(attemptId: string, optionId: string): Promise<CommitDecisionResult | null>;
}

const memoryBackend: TurnRuntimeBackend = {
  getState: runtimeState,
  postMessage: postRuntimeMessage,
  commitDecision: commitRuntimeDecision,
};

export async function createTurnRuntimeBackend(): Promise<TurnRuntimeBackend | null> {
  if (process.env.NODE_ENV === "test" && process.env.TURN_API_BACKEND !== "supabase") {
    return memoryBackend;
  }

  const userClient = await createClient();
  const { data, error } = await userClient.auth.getUser();
  if (error !== null || data.user === null) return null;
  return new SupabaseRuntimeStore(userClient, createAdminClient());
}
