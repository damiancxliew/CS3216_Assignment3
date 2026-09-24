"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { button, ErrorText, Pending } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** Follows the one asset row until a redraw settles. */
export function AssetRegeneration({
  action,
  specVersionId,
  assetId,
}: {
  action: () => Promise<ActionResult>;
  specVersionId: string;
  assetId: string;
}) {
  const router = useRouter();
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<string | null | undefined>();
  const [outcome, setOutcome] = useState<"ready" | "failed" | "unknown" | null>(null);
  const [result, formAction, pending] = useActionState(async () => {
    const { data } = await createClient().from("asset")
      .select("updated_at")
      .eq("spec_version_id", specVersionId)
      .eq("asset_id", assetId)
      .maybeSingle<{ updated_at: string }>();
    setBaseline(data?.updated_at ?? null);
    return action();
  }, {} as ActionResult);
  const working = pending || (requestedAt !== null && outcome === null && !result.error);

  useEffect(() => {
    if (requestedAt === null || baseline === undefined || result.error || outcome !== null) return;
    const client = createClient();
    let active = true;
    const poll = async () => {
      if (Date.now() - requestedAt > 360_000) {
        if (active) setOutcome("unknown");
        return;
      }
      const { data } = await client.from("asset")
        .select("status, updated_at")
        .eq("spec_version_id", specVersionId)
        .eq("asset_id", assetId)
        .maybeSingle<{ status: string; updated_at: string }>();
      if (!active || !data || data.updated_at === baseline || data.status === "pending") return;
      setOutcome(data.status === "ready" || data.status === "cached" ? "ready" : "failed");
      router.refresh();
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [assetId, baseline, outcome, requestedAt, result.error, router, specVersionId]);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <button
          type="submit"
          disabled={working}
          onClick={() => { setBaseline(undefined); setOutcome(null); setRequestedAt(Date.now()); }}
          className={button.quiet}
        >
          {working ? <Pending>Regenerating…</Pending> : "Regenerate"}
        </button>
      </form>
      {working ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm text-muted">
          <span>Drawing a new image…</span>
          <progress aria-label="Image regeneration in progress" className="h-2 w-full accent-world" />
        </div>
      ) : result.error ? <ErrorText>{result.error}</ErrorText>
        : outcome === "failed" ? <p className="text-sm text-danger">Couldn’t generate a new image.</p>
          : outcome === "unknown" ? <p className="text-sm text-muted">Image status is unavailable. Refresh to check it.</p>
            : outcome === "ready" ? <p className="text-sm text-muted">New image ready.</p>
              : null}
    </div>
  );
}
