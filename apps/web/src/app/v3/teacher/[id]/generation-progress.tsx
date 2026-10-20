"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Thinking } from "@/components/ui";
import { ProgressBar } from "@/components/teacher/progress-bar";
import { PASS_LABELS, PASS_ORDER, stepDisplayStatus } from "@/lib/v3/generation/labels";

import { getV3GenerationProgress } from "../actions";

type Progress = Awaited<ReturnType<typeof getV3GenerationProgress>>;

/** The generating view: one row per pass, refreshed every 4 s like the artwork poller. */
export function GenerationProgress({ adventureId, seesCost, compact = false }: { adventureId: string; seesCost: boolean; compact?: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await getV3GenerationProgress(adventureId);
        if (cancelled) return;
        if ("error" in result) { setRetrying(true); return; }
        setRetrying(false);
        setProgress(result);
        if (result.status !== "generating") router.refresh();
      } catch { if (!cancelled) setRetrying(true); }
    };
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adventureId, router]);

  const steps = progress && !("error" in progress) ? progress.steps : [];
  const byName = new Map(steps.map((step) => [step.name, step]));
  const done = PASS_ORDER.filter((name) => stepDisplayStatus(byName.get(name)?.status) === "done").length;
  const anyRunning = PASS_ORDER.some((name) => stepDisplayStatus(byName.get(name)?.status) === "running");

  const running = PASS_ORDER.find(name => stepDisplayStatus(byName.get(name)?.status) === "running") ?? PASS_ORDER.find(name => stepDisplayStatus(byName.get(name)?.status) !== "done");
  if (compact) return <section className="rounded-surface border border-line bg-surface px-5 py-4" aria-label="Generation progress"><Thinking label={retrying ? "Reconnecting… Your content is still here." : running ? `Preparing ${PASS_LABELS[running].toLowerCase()}…` : "Finishing up…"} /><p className="mt-2 text-xs text-muted">{done} of {PASS_ORDER.length} steps complete · Your conversation and completed cards stay available.</p>{seesCost && progress && !("error" in progress) ? <p className="mt-1 text-xs text-muted">Cost so far: ${progress.costUsd.toFixed(4)}</p> : null}</section>;
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {retrying ? <p role="status" className="text-sm">Could not refresh progress. Retrying…</p> : null}
      <ProgressBar value={done} max={PASS_ORDER.length} indeterminate={done === 0 && !anyRunning} label="Generation progress" />
      <ol className="flex flex-col gap-1">
        {PASS_ORDER.map((name) => {
          const status = stepDisplayStatus(byName.get(name)?.status);
          return (
            <li key={name} className="flex items-center justify-between gap-4 py-1.5 text-sm">
              <span className="font-semibold text-ink">{PASS_LABELS[name]}</span>
              <span className={status === "failed" ? "font-bold text-signal" : "text-muted"}>
                {status === "waiting" ? "waiting" : status === "running" ? "running" : status === "done" ? "done" : "failed"}
              </span>
            </li>
          );
        })}
      </ol>
      {seesCost && progress && !("error" in progress) ? <p className="text-xs text-muted">Cost so far: ${progress.costUsd.toFixed(4)}</p> : null}
    </div>
  );
}
