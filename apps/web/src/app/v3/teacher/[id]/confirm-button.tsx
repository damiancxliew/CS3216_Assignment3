"use client";

import { useRef } from "react";

import { button, Pending, StableLabel } from "@/components/ui";

/**
 * A popup confirm (the team's convention for destructive or committing
 * actions): a native <dialog> with a title, a one-line body, Cancel and the
 * confirm action. Esc closes it; focus returns to the trigger automatically.
 * The trigger keeps its size and label while pending — no layout shift.
 */
export function ConfirmButton({
  label,
  pendingLabel,
  title,
  body,
  confirmLabel = "Yes",
  className = button.subtle,
  disabled = false,
  pending = false,
  onConfirm,
}: {
  label: string;
  pendingLabel?: string;
  title: string;
  body: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} disabled={disabled || pending} className={className}>
        <StableLabel label={label} pending={pending} pendingLabel={<Pending>{pendingLabel ?? "Working…"}</Pending>} />
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-full max-w-md rounded-surface border-2 border-ink bg-surface p-6 shadow-[0_8px_0_color-mix(in_srgb,var(--ink)_15%,transparent)] backdrop:bg-ink/30"
      >
        <h3 className="text-lg font-black tracking-tight text-ink">{title}</h3>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className={button.subtle} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
            className={button.primary}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
