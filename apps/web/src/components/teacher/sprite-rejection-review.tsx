"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { button, ErrorText, Pending } from "@/components/ui";

const REFERENCE = "/game/ninja/characters/Boy/walk.png";

export function SpriteRejectionReview({ imageUrl, action }: { imageUrl: string; action: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState(async () => {
    try {
      const outcome = await action();
      router.refresh();
      return outcome;
    } catch {
      router.refresh();
      return { error: "Couldn’t accept this sprite. Please try again." };
    }
  }, {} as ActionResult);

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-semibold text-ink">Compare and review sprite</summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <figure>
          <img src={REFERENCE} alt="Correct four-direction walking pose reference" width={128} height={128} className="aspect-square w-full rounded-control border border-line bg-sunken grayscale [image-rendering:pixelated]" />
          <figcaption className="mt-1 text-xs text-muted">Pose reference</figcaption>
        </figure>
        <figure>
          <img src={imageUrl} alt="Rejected generated walking sprite" width={128} height={128} className="aspect-square w-full rounded-control border border-line bg-sunken [image-rendering:pixelated]" />
          <figcaption className="mt-1 text-xs text-muted">Generated sprite</figcaption>
        </figure>
      </div>
      <p className="mt-2 text-xs text-muted">Columns should face down, up, left and right. Each column should keep its direction while walking.</p>
      <form action={formAction} className="mt-2">
        <button type="submit" disabled={pending} className={button.quiet}>
          {pending ? <Pending>Accepting…</Pending> : "Accept this sprite anyway"}
        </button>
      </form>
      {result.error ? <ErrorText>{result.error}</ErrorText> : result.notice ? <p className="mt-1 text-sm text-muted">{result.notice}</p> : null}
    </details>
  );
}
