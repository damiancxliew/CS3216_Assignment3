"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";

export function StartOverButton({ attemptId }: { attemptId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const actionClass = `${styles.tool} inline-flex min-h-9 items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffe0a2]`;

  async function startOver() {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/v3/attempts/${encodeURIComponent(attemptId)}/restart`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { attemptId?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.attemptId) throw new Error(body?.error?.message ?? "Could not start over. Try again.");
      window.location.assign(`/v3/play/${encodeURIComponent(body.attemptId)}`);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not start over. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" aria-label="Start over" aria-haspopup="dialog" onClick={() => setConfirming(true)} className={actionClass}>
        <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Start over</span>
      </button>
      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => { if (!busy) setConfirming(false); }}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="start-over-title"
            aria-describedby="start-over-text"
            className="w-full max-w-sm rounded-xl border-2 border-ink bg-[#fffaf0] p-5 text-ink shadow-[4px_4px_0_var(--ink)]"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape" && !busy) setConfirming(false); }}
          >
            <h2 id="start-over-title" className="text-lg font-bold">Start over?</h2>
            <p id="start-over-text" className="mt-2 text-sm">You will begin again from the briefing with empty notes. Your teacher can still see this attempt.</p>
            {failure ? <p role="alert" className="mt-2 text-sm font-semibold text-signal">{failure}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" autoFocus disabled={busy} onClick={() => setConfirming(false)} className="min-h-9 rounded-lg px-3 text-sm font-semibold underline">Keep playing</button>
              <button type="button" disabled={busy} onClick={startOver} className="min-h-9 rounded-lg bg-ink px-3 text-sm font-semibold text-[#fffaf0] disabled:opacity-60">
                {busy ? "Starting over…" : "Start over"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
