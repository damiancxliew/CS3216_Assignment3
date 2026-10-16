"use client";

import { useState } from "react";

import { button } from "@/components/ui";

/** A two-step confirm: the first click opens an inline "are you sure" pair, never a shifted button. */
export function ConfirmButton({
  label,
  confirmLabel = "Are you sure?",
  className = button.subtle,
  disabled = false,
  onConfirm,
  children,
}: {
  label: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} disabled={disabled} className={className}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-sm font-semibold text-muted">{confirmLabel}</span>
      <button type="button" onClick={onConfirm} disabled={disabled} className={className}>
        Yes
      </button>
      <button type="button" onClick={() => setArmed(false)} disabled={disabled} className={className}>
        Cancel
      </button>
      {children}
    </span>
  );
}
