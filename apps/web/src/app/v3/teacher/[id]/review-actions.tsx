"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { button, ErrorText } from "@/components/ui";

import { restartV3Generation } from "../actions";
import { ConfirmButton } from "./confirm-button";
import { ReviewToolbar } from "./review-toolbar";
import { reviewCreate } from "./creation-styles";

/** failed: Start again sits in the bottom bar's primary slot, beside the stopped progress. */
export function StartAgain({ adventureId }: { adventureId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ReviewToolbar
        primary={
          <ConfirmButton
            label="Start again"
            pendingLabel="Restarting…"
            title="Start again?"
            body="A fresh brief opens with the same sources and your earlier answers."
            confirmLabel="Start again"
            className={reviewCreate}
            pending={pending}
            onConfirm={() =>
              startTransition(async () => {
                const result = await restartV3Generation(adventureId);
                if ("error" in result) setError(result.error);
                else if ("adventureId" in result) router.push(`/v3/teacher/${result.adventureId}`);
              })
            }
          />
        }
      />
    </>
  );
}

const STUCK_REFRESHES = 8;

/**
 * A paused step whose content couldn't be loaded yet: keep refreshing for about
 * half a minute, then say so plainly instead of promising a retry that never comes.
 */
export function PendingContent() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const stuck = attempts >= STUCK_REFRESHES;
  useEffect(() => {
    if (stuck) return;
    const timer = setTimeout(() => { router.refresh(); setAttempts((value) => value + 1); }, 4000);
    return () => clearTimeout(timer);
  }, [attempts, stuck, router]);
  return stuck ? (
    <div role="alert" className="space-y-3 text-sm">
      <p>This step’s content didn’t load. Your work is saved.</p>
      <button type="button" className={button.subtle} onClick={() => window.location.reload()}>Reload the page</button>
    </div>
  ) : (
    <p role="status" className="text-sm text-muted">Loading this step…</p>
  );
}
