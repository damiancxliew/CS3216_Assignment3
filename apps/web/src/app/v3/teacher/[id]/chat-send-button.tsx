"use client";
import { useId } from "react";
import { ArrowUp } from "lucide-react";
import { compactButton } from "@/components/ui";

/** Disabled send controls keep their explanation available on hover and keyboard focus. */
export function ChatSendButton({
  disabled,
  hint,
  label = "Send message",
}: {
  disabled: boolean;
  hint: string;
  label?: string;
}) {
  const tooltipId = useId();
  return (
    <span
      className="group/send relative inline-flex shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-record"
      tabIndex={disabled ? 0 : undefined}
      role={disabled ? "group" : undefined}
      aria-label={disabled ? `${label} unavailable` : undefined}
      aria-describedby={disabled ? tooltipId : undefined}
    >
      <button
        type="submit"
        aria-label={label}
        aria-describedby={disabled ? tooltipId : undefined}
        disabled={disabled}
        className={
          compactButton.quiet + " h-11 w-11 !px-0 disabled:pointer-events-none"
        }
      >
        <ArrowUp size={18} aria-hidden />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full right-0 z-50 mb-2 w-56 max-w-[calc(100vw-2rem)] rounded-control border border-ink bg-ink px-3 py-2 text-xs text-paper shadow-md group-hover/send:visible group-focus-within/send:visible"
      >
        {hint}
      </span>
    </span>
  );
}
