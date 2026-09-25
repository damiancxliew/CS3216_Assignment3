"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { ProgressBar } from "@/components/teacher/progress-bar";
import { button, ErrorText, Pending } from "@/components/ui";

/** Keep the button busy until the redraw has actually settled. */
export function AssetRegeneration({ action }: { action: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState(async () => {
    try {
      const outcome = await action();
      router.refresh();
      return outcome;
    } catch {
      router.refresh();
      return { error: "Regeneration stopped before completion. Please try again." };
    }
  }, {} as ActionResult);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <button type="submit" disabled={pending} className={button.quiet}>
          {pending ? <Pending>Regenerating…</Pending> : "Regenerate"}
        </button>
      </form>
      {pending ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm text-muted">
          <span>Drawing a new image…</span>
          <ProgressBar indeterminate label="Image regeneration in progress" />
        </div>
      ) : result.error ? <ErrorText>{result.error}</ErrorText>
        : result.notice ? <p className="text-sm text-muted">{result.notice}</p>
          : null}
    </div>
  );
}
