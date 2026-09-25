"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { ProgressBar } from "@/components/teacher/progress-bar";
import { button, ErrorText, Pending } from "@/components/ui";

/** Refreshes the server projection while asset rows settle and shows measured progress. */
export function ArtworkProgress({
  action,
  label,
  assets,
  watchForArtwork,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  assets: { eligible: number; generated: number; pending: number; failed: number; started: boolean };
  watchForArtwork: boolean;
}) {
  const router = useRouter();
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [sawPending, setSawPending] = useState(false);
  const [result, formAction, pending] = useActionState(action, {} as ActionResult);
  const requested = requestedAt !== null && Date.now() - requestedAt < 60_000;
  const starting = requested || (!assets.started && watchForArtwork);
  const working = pending || watchForArtwork || starting || assets.pending > 0;
  const processed = Math.min(assets.eligible, assets.generated + assets.failed);

  useEffect(() => {
    if (!working || pending) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [working, pending, router]);

  useEffect(() => {
    if (assets.pending > 0) setSawPending(true);
    if (sawPending && assets.pending === 0) setRequestedAt(null);
    if (!pending && result.error) setRequestedAt(null);
  }, [assets.pending, pending, result.error, sawPending]);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <button type="submit" disabled={working} onClick={() => { setSawPending(false); setRequestedAt(Date.now()); }} className={button.primary}>
          {working ? <Pending>Artwork pending…</Pending> : label}
        </button>
      </form>
      {assets.eligible > 0 && (assets.started || working) ? (
        <div role="status" aria-live="polite" className="flex max-w-xl flex-col gap-2 text-sm text-muted">
          {starting && assets.pending === 0 ? (
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
          {assets.pending > 0 ? <p>Finished images appear in the gallery below.</p> : null}
        </div>
      ) : null}
      {result.error ? <ErrorText>{result.error}</ErrorText> : result.notice && !working && !sawPending ? <p className="text-base text-muted">{result.notice}</p> : null}
    </div>
  );
}
