"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

import type { ActionResult } from "../actions";
import { button, ErrorText, Pending } from "@/components/ui";
import { ProgressBar } from "@/components/teacher/progress-bar";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";

export type GenerationJob = {
  state: "running" | "completed" | "failed";
  phase: "preparing" | "planning" | "checking" | "repairing" | "saving" | "completed" | "failed";
  started_at: string;
  updated_at: string;
  message: string | null;
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
  advance,
  label,
  initialJob,
  disabled = false,
  children,
}: {
  adventureId: string;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  advance: () => Promise<ActionResult>;
  label: string;
  initialJob: GenerationJob | null;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [requested, setRequested] = useState(false);
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const refreshedRun = useRef<string | null>(null);
  const advancing = useRef(false);
  const previousRun = useRef<string | null>(initialJob?.started_at ?? null);
  const [result, formAction, pending] = useActionState(async (prev: ActionResult, formData: FormData) => {
    return action(prev, formData);
  }, {} as ActionResult);
  const running = job?.state === "running";

  useEffect(() => {
    if (!pending && !requested && !running) return;
    const client = createClient();
    let active = true;
    const poll = async () => {
      const { data } = await client.from("generation_job")
        .select("state, phase, started_at, updated_at, message")
        .eq("adventure_id", adventureId)
        .maybeSingle<GenerationJob>();
      if (!active || !data) return;
      setJob(data);
      if (data.state === "running" && !advancing.current) {
        advancing.current = true;
        void advance()
          .then((step) => setContinuationError(step.error ?? null))
          .catch(() => setContinuationError("Couldn’t continue story generation. Retrying…"))
          .finally(() => { advancing.current = false; });
      }
      if (data.state !== "running" && (!requested || data.started_at !== previousRun.current)) {
        setRequested(false);
        if (data.state === "completed" && refreshedRun.current !== data.started_at) {
          refreshedRun.current = data.started_at;
          track(ANALYTICS_EVENTS.generationCompleted);
          router.refresh();
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [adventureId, advance, pending, requested, router, running]);

  useEffect(() => {
    if (!pending && result.error) setRequested(false);
  }, [pending, result.error]);

  const busy = pending || requested || running;
  const status = busy ? PHASE_LABEL[job?.state === "running" ? job.phase : "preparing"] : null;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-4" onSubmit={() => { previousRun.current = job?.started_at ?? null; setRequested(true); }}>
        {children}
        {/* Disabling in onClick cancels the button's native form submission. */}
        <button type="submit" disabled={busy || disabled} className={`${button.primary} w-fit`}>
          {busy ? <Pending>Generating…</Pending> : label}
        </button>
      </form>
      {busy ? (
        <div role="status" aria-live="polite" className="flex max-w-xl flex-col gap-2 text-sm text-muted">
          <p>{status}. You can leave this page and return to continue later.</p>
          {continuationError ? <ErrorText>{continuationError}</ErrorText> : null}
          <ProgressBar indeterminate label="Story generation in progress" />
        </div>
      ) : result.error ? <ErrorText>{result.error}</ErrorText>
        : job?.state === "failed" ? <ErrorText>{job.message ?? "The last generation attempt did not finish. Try again."}</ErrorText>
          : job?.state === "completed" ? <p className="text-base text-muted">{job.message ?? "Draft ready."}</p>
            : result.notice ? <p className="text-base text-muted">{result.notice}</p>
            : null}
    </div>
  );
}
