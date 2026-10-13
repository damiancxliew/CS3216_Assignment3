"use client";

import { useEffect, useRef, useState } from "react";

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
  align = "end",
  triggerClassName,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmMessage: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setConfirming(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setConfirming(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [confirming]);

  const closeAndFocusTrigger = () => {
    setConfirming(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={icon ? `${iconButton} hover:border-danger hover:text-danger` : triggerClassName ?? button.quiet}
        aria-label={icon ? ariaLabel : undefined}
        title={icon ? ariaLabel : undefined}
        aria-haspopup="dialog"
        aria-expanded={confirming}
        onClick={() => setConfirming((open) => !open)}
      >
        {icon ?? label}
      </button>
      {confirming ? (
        <div
          role="dialog"
          aria-label={`${label} confirmation`}
          className={`absolute top-full z-50 mt-2 w-72 rounded-surface border border-line bg-paper p-4 shadow ${align === "start" ? "left-0" : "right-0"}`}
        >
          <p className="text-sm text-muted">{confirmMessage}</p>
          <div className="mt-3 flex items-center gap-2">
            <ActionButton
              action={action}
              label={`Confirm ${label.toLowerCase()}`}
              pendingLabel="Working…"
              variant="quiet"
              onDone={(result) => {
                if (!result.error) closeAndFocusTrigger();
              }}
            />
            <button ref={cancelRef} type="button" className={button.link} onClick={closeAndFocusTrigger}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
