"use client";

import { useState } from "react";

import { ActionButton } from "@/components/action-form";
import { button } from "@/components/ui";
import type { ActionResult } from "@/app/teacher/actions";

export function ConfirmActionButton({
  action,
  label,
  confirmMessage,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmMessage: string;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <div className="flex flex-col items-start gap-2">
      <span className="text-sm text-muted">{confirmMessage}</span>
      <div className="flex items-center gap-2">
        <ActionButton action={action} label={`Confirm ${label.toLowerCase()}`} pendingLabel="Working…" variant="quiet" />
        <button type="button" className={button.link} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>
  ) : (
    <button type="button" className={button.quiet} onClick={() => setConfirming(true)}>{label}</button>
  );
}
