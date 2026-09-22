"use client";

import { useEffect, useState } from "react";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";

/**
 * Renders the stage timer (P6/D12/FR-16). The deadline is whatever the server
 * says it is: this component never computes, extends or stores one, so a
 * refresh re-reads the same instant and a device clock that is wrong only makes
 * the displayed number wrong, not the moment the stage actually closes.
 *
 * `serverNowIso` is the server's clock at render time; the difference against
 * the browser's clock at mount is used to correct the *displayed* number, so a
 * skewed device shows the right countdown instead of a plausible wrong one.
 *
 * When the deadline passes, the pass is recorded by the database — the client
 * asks it to check, and `expire_stage_if_due` compares `now()` itself and does
 * nothing if the player got in first.
 */
export function StageCountdown({
  attemptId,
  deadlineIso,
  serverNowIso,
}: {
  attemptId: string;
  deadlineIso: string | null;
  serverNowIso: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [skewMs] = useState(() => new Date(serverNowIso).getTime() - Date.now());

  useEffect(() => {
    if (!deadlineIso) return;
    const deadline = new Date(deadlineIso).getTime();

    const tick = () => {
      const left = Math.max(0, deadline - (Date.now() + skewMs));
      setRemaining(left);
      if (left === 0) setExpired(true);
      return left;
    };

    tick();
    const interval = setInterval(() => {
      if (tick() === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [deadlineIso, skewMs]);

  useEffect(() => {
    if (!expired) return;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("expire_stage_if_due", {
        p_attempt_id: attemptId,
      });
      if (data === true) track(ANALYTICS_EVENTS.stageTimerExpired);
    })();
  }, [expired, attemptId]);

  if (!deadlineIso) {
    return <span className="opacity-60">No timer on this stage</span>;
  }
  if (remaining === null) return <span className="opacity-60">…</span>;
  if (remaining === 0) {
    return (
      <span className="font-mono">
        0:00 <span className="opacity-60">— time is up, you passed</span>
      </span>
    );
  }

  const total = Math.ceil(remaining / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return (
    <span className="font-mono">{`${minutes}:${String(seconds).padStart(2, "0")}`}</span>
  );
}
