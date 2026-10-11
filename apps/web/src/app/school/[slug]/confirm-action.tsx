"use client";

import { useState } from "react";

import { ActionButton } from "@/components/action-form";
import { button } from "@/components/ui";
import type { ActionResult } from "@/app/teacher/actions";

const iconButton =
  "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

export function ConfirmActionButton({
  action,
  label,
  confirmMessage,
  icon,
  ariaLabel,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmMessage: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
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
    <button
      type="button"
      className={icon ? `${iconButton} hover:border-danger hover:text-danger` : button.quiet}
      aria-label={icon ? ariaLabel : undefined}
      title={icon ? ariaLabel : undefined}
      onClick={() => setConfirming(true)}
    >
      {icon ?? label}
    </button>
  );
}
