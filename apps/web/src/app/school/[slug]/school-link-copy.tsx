"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

export function SchoolLinkCopy({
  path,
  label = "Copy link",
  disabledReason,
}: {
  path: string;
  label?: string;
  disabledReason?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const buttonLabel = disabledReason ?? (
    status === "copied" ? "Copied" : status === "failed" ? "Couldn’t copy. Select the link and copy it." : label
  );
  const Icon = status === "copied" ? Check : status === "failed" ? X : Copy;
  return (
    <button
      type="button"
      aria-label={buttonLabel}
      aria-disabled={disabledReason ? "true" : undefined}
      title={buttonLabel}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface text-ink ${
        disabledReason
          ? "cursor-not-allowed opacity-40"
          : "cursor-pointer shadow-[0_3px_0_var(--ink)] transition-all hover:-translate-y-0.5 hover:bg-signal-wash active:translate-y-0.5 active:shadow-none"
      }`}
      onClick={async () => {
        if (disabledReason) return;
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setStatus("copied");
        } catch (error) {
          console.error("could not copy link", error);
          setStatus("failed");
        }
      }}
    >
      <Icon aria-hidden className={`h-5 w-5 ${status === "failed" ? "text-danger" : ""}`} />
      <span aria-live="polite" className="sr-only">{status === "idle" ? "" : buttonLabel}</span>
    </button>
  );
}
