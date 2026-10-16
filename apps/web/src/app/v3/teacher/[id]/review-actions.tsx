"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { button, ErrorText, Pending } from "@/components/ui";

import { approveV3Skeleton, restartV3Generation } from "../actions";
import { ConfirmButton } from "./confirm-button";

/** needs_review: continue generation with the skeleton as it stands (PR B adds the editor). */
export function ContinueGeneration({ adventureId }: { adventureId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex items-center gap-3">
        <ConfirmButton
          label="Continue generation"
          confirmLabel="Generate the rest with this skeleton?"
          className={button.primary}
          disabled={pending}
          onConfirm={() =>
            startTransition(async () => {
              const result = await approveV3Skeleton(adventureId);
              if ("error" in result) setError(result.error);
              else router.refresh();
            })
          }
        />
        {pending ? <Pending>Continuing…</Pending> : null}
      </div>
    </div>
  );
}

/** failed: a fresh brief with the same sources and answers, landed on the summary. */
export function StartAgain({ adventureId }: { adventureId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={button.primary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await restartV3Generation(adventureId);
              if ("error" in result) setError(result.error);
              else if ("adventureId" in result) router.push(`/v3/teacher/${result.adventureId}`);
            })
          }
        >
          {pending ? <Pending>Restarting…</Pending> : "Start again"}
        </button>
      </div>
    </div>
  );
}
