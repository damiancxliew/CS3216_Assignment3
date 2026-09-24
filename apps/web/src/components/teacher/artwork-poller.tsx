"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
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
          {working ? <Pending>Generating artwork…</Pending> : label}
        </button>
      </form>
      {assets.eligible > 0 && (assets.started || working) ? (
        <div role="status" aria-live="polite" className="flex max-w-xl flex-col gap-2 text-sm text-muted">
          <p>{starting && assets.pending === 0 ? "Starting artwork generation…" : `${processed} of ${assets.eligible} images processed · ${assets.generated} ready${assets.failed ? ` · ${assets.failed} unsuccessful` : ""}`}</p>
          {starting && assets.pending === 0
            ? <progress aria-label="Starting artwork generation" className="h-2 w-full accent-world" />
            : <progress value={processed} max={assets.eligible} aria-label="Artwork generation progress" className="h-2 w-full accent-world" />}
          {assets.pending > 0 ? <p>Finished images appear in the gallery below.</p> : null}
        </div>
      ) : null}
      {result.error ? <ErrorText>{result.error}</ErrorText> : result.notice && !working && !sawPending ? <p className="text-base text-muted">{result.notice}</p> : null}
    </div>
  );
}
