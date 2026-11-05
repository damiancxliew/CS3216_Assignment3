"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import type { GenerationProgress as ProgressData } from "@/lib/v3/generation/service";
import styles from "./progress.module.css";

import { ProgressBar } from "@/components/teacher/progress-bar";
import { PASS_ORDER, type PassName } from "@/lib/v3/generation/labels";

import { getV3GenerationProgress } from "../actions";

const activity: Record<PassName, string> = { sources: "Reading sources", skeleton: "Planning the story", details: "Writing scenes", endings: "Writing endings", reveal: "Writing the reveal", check: "Checking the story", save: "Saving the draft" };
const stepNames: Record<PassName, string> = { sources: "sources", skeleton: "story outline", details: "scenes", endings: "endings", reveal: "reveal", check: "checks", save: "save" };

/** Polls progress every 4 s, starting from the server's snapshot so the bar never resets. */
export function GenerationProgress({ adventureId, seesCost, initial = null }: { adventureId: string; seesCost: boolean; initial?: ProgressData | null }) {
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressData | null>(initial);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const clockRunning = !retrying && isWorking(progress) && !!progress?.steps.some((step) => step.status === "running" && step.startedAt);

  useEffect(() => {
    if (!clockRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [clockRunning]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await getV3GenerationProgress(adventureId);
        if (cancelled) return;
        if ("error" in result) { setRetrying(true); return; }
        setRetrying(false);
        setProgress(result);
        setNow(Date.now());
        // A pass marks the row for review just before its step is recorded as done.
        if (!isWorking(result)) router.refresh();
      } catch { if (!cancelled) setRetrying(true); }
    };
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adventureId, router]);

  return <GenerationProgressCard progress={progress} reconnecting={retrying} seesCost={seesCost} now={now} />;
}

/** Still generating, including the moment a pass has paused the row but its step is not yet recorded. */
function isWorking(progress: ProgressData | null) {
  return !progress || progress.status === "generating" || (progress.status === "needs_review" && !progress.pausedAt);
}

/** The toolbar's overall-build bar. Activity text is visible only while a step runs or after a stop. */
export function GenerationProgressCard({ progress, reconnecting = false, seesCost, now }: {
  progress: ProgressData | null;
  reconnecting?: boolean;
  seesCost: boolean;
  now: number;
}) {
  const byName = new Map((progress?.steps ?? []).map((step) => [step.name, step]));
  const done = PASS_ORDER.filter((name) => byName.get(name)?.status === "succeeded").length;
  const running = PASS_ORDER.find((name) => byName.get(name)?.status === "running");
  const failedStep = PASS_ORDER.find((name) => byName.get(name)?.status === "failed");
  const failed = progress?.status === "failed" || !!failedStep;
  const working = isWorking(progress) && !failed;
  const active = working && !reconnecting;
  const start = running ? Date.parse(byName.get(running)?.startedAt ?? "") : NaN;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const clock = active && Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}` : null;
  const visible = reconnecting && working ? "Reconnecting…"
    : failed ? `Stopped${failedStep ? ` at ${stepNames[failedStep]}` : ""}`
    : active ? `${running ? activity[running] : "Preparing"}${clock ? ` · ${clock}` : "…"}`
    : null;
  const status = visible ?? (progress?.status === "needs_review" ? "Ready for your review" : progress?.status === "draft" || progress?.status === "published" ? "Adventure ready" : "");
  const summary = `Overall build: ${done} of ${PASS_ORDER.length} steps${seesCost && progress ? ` · $${progress.costUsd.toFixed(4)}` : ""}`;

  return (
    <section aria-label="Generation progress" className={`${styles.toolbar} ${active ? "" : styles.still}`} title={summary}>
      <span role="status" className="sr-only">{status}</span>
      <div className={styles.inlineRow}>
        {visible ? <span aria-hidden className={failed ? styles.inlineFailure : styles.inlineActivity}>{visible}</span> : null}
        <div className={styles.inlineTrack}><ProgressBar value={done} max={PASS_ORDER.length} label="Generation steps" indeterminate={!progress && !reconnecting} /></div>
        <span className={styles.inlineMeta}>{done}/{PASS_ORDER.length}</span>
      </div>
    </section>
  );
}
