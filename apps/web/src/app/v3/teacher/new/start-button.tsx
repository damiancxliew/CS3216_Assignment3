"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { button, ErrorText, Pending, StableLabel } from "@/components/ui";

import { startV3Brief } from "../actions";

/** Creates (or reuses) the brief row and routes into the chat. */
export function StartBriefButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div>
        <button
          type="button"
          className={button.primary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await startV3Brief();
              if ("error" in result) setError(result.error);
              else if ("adventureId" in result) router.push(`/v3/teacher/${result.adventureId}`);
            })
          }
        >
          <StableLabel label="Start" pending={pending} pendingLabel={<Pending>Starting…</Pending>} />
        </button>
      </div>
    </div>
  );
}
