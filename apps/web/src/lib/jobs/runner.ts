import { createJobs, supabaseJobStore } from "@adventure/jobs";

import { createAdminClient } from "@/lib/supabase/admin";
import { TICK_SECRET_HEADER } from "./tick";
import { jobSteps } from "./steps";

let jobs: ReturnType<typeof createJobs> | undefined;

export function getJobs(): ReturnType<typeof createJobs> {
  jobs ??= createJobs(supabaseJobStore(createAdminClient()), jobSteps);
  return jobs;
}

/** Yi Hao's create flow calls this after enqueue. */
export async function kickTick(url: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const secret = env.JOBS_TICK_SECRET;
    if (!secret) throw new Error("JOBS_TICK_SECRET is not configured");

    const response = await fetch(url, {
      method: "POST",
      headers: { [TICK_SECRET_HEADER]: secret },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Jobs tick returned HTTP ${response.status}`);
  } catch (error) {
    console.error("Jobs tick request failed", error);
  }
}
