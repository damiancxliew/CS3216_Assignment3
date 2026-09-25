"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ProgressBar } from "@/components/teacher/progress-bar";

/** Refreshes the server projection while asset rows settle and shows measured progress. */
export function ArtworkProgress({
  assets,
  watchForArtwork,
}: {
  assets: { eligible: number; generated: number; pending: number; failed: number; started: boolean };
  watchForArtwork: boolean;
}) {
  const router = useRouter();
  const starting = !assets.started && watchForArtwork;
  const working = watchForArtwork || assets.pending > 0;
  const processed = Math.min(assets.eligible, assets.generated + assets.failed);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [working, router]);

  if (!working) {
    return assets.failed > 0 ? (
      <p className="text-sm text-muted">
        {assets.failed} image{assets.failed === 1 ? "" : "s"} didn’t generate. Use Regenerate on a tile to try again.
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="status" aria-live="polite" className="flex max-w-xl flex-col gap-2 text-sm text-muted">
        {(starting && assets.pending === 0) || assets.eligible === 0 ? (
          <>
            <p>Waiting for artwork generation…</p>
            <ProgressBar indeterminate label="Waiting for artwork generation" />
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p>{`${processed} of ${assets.eligible} images processed · ${assets.generated} ready${assets.failed ? ` · ${assets.failed} unsuccessful` : ""}`}</p>
              <span className="tabular-nums font-semibold text-ink">{Math.round((processed / assets.eligible) * 100)}%</span>
            </div>
            <ProgressBar value={processed} max={assets.eligible} label="Artwork generation progress" />
          </>
        )}
        <p>Finished images appear in the gallery below.</p>
      </div>
    </div>
  );
}
