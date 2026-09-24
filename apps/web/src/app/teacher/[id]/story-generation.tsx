"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import type { ActionResult } from "../actions";
import { button, ErrorText, Pending } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";

export type GenerationJob = {
  state: "running" | "completed" | "failed";
  phase: "preparing" | "planning" | "checking" | "repairing" | "saving" | "completed" | "failed";
  started_at: string;
  updated_at: string;
};

const PHASE_LABEL: Record<GenerationJob["phase"], string> = {
  preparing: "Preparing the sources",
  planning: "Writing the story and stages",
  checking: "Checking the story against the sources",
  repairing: "Revising the story",
  saving: "Saving the draft",
  completed: "Draft ready",
  failed: "Generation stopped",
};

/** The planner reports real phases, but its model calls have no predictable duration. */
export function StoryGeneration({
  adventureId,
  action,
  label,
  initialJob,
}: {
  adventureId: string;
  action: () => Promise<ActionResult>;
  label: string;
  initialJob: GenerationJob | null;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [requested, setRequested] = useState(false);
  const refreshedRun = useRef<string | null>(null);
  const previousRun = useRef<string | null>(initialJob?.started_at ?? null);
  const [result, formAction, pending] = useActionState(async () => {
    const response = await action();
    if (!response.error && !response.notice?.includes("already in progress")) track(ANALYTICS_EVENTS.generationCompleted);
    return response;
  }, {} as ActionResult);
  const running = job?.state === "running" && Date.now() - Date.parse(job.updated_at) < 360_000;
  const stale = job?.state === "running" && !running;

  useEffect(() => {
    if (!pending && !requested && !running) return;
    const client = createClient();
    let active = true;
    const poll = async () => {
      const { data } = await client.from("generation_job")
        .select("state, phase, started_at, updated_at")
        .eq("adventure_id", adventureId)
        .maybeSingle<GenerationJob>();
      if (!active || !data) return;
      setJob(data);
      if (data.state !== "running" && (!requested || data.started_at !== previousRun.current)) {
        setRequested(false);
        if (data.state === "completed" && refreshedRun.current !== data.started_at) {
          refreshedRun.current = data.started_at;
          router.refresh();
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => { active = false; clearInterval(timer); };
  }, [adventureId, pending, requested, router, running]);

  useEffect(() => {
    if (!pending && (result.error || result.notice)) setRequested(false);
  }, [pending, result.error, result.notice]);

  const busy = pending || requested || running;
  const status = busy ? PHASE_LABEL[job?.state === "running" ? job.phase : "preparing"] : null;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <button type="submit" disabled={busy} onClick={() => { previousRun.current = job?.started_at ?? null; setRequested(true); }} className={button.primary}>
          {busy ? <Pending>Generating…</Pending> : label}
        </button>
      </form>
      {busy ? (
        <div role="status" aria-live="polite" className="flex max-w-xl flex-col gap-2 text-sm text-muted">
          <p>{status}. This can take a few minutes.</p>
          <progress aria-label="Story generation in progress" className="h-2 w-full accent-world" />
        </div>
      ) : result.error ? <ErrorText>{result.error}</ErrorText>
        : result.notice ? <p className="text-base text-muted">{result.notice}</p>
          : stale ? <p className="text-sm text-muted">The last status update is old. Check for a new draft, then try again if needed.</p>
            : job?.state === "failed" ? <p className="text-sm text-muted">The last generation attempt did not finish. Try again.</p>
            : null}
    </div>
  );
}
