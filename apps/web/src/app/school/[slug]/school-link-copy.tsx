"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

export function SchoolLinkCopy({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const label = status === "copied" ? "Copied" : status === "failed" ? "Couldn’t copy. Select the link and copy it." : "Copy link";
  const Icon = status === "copied" ? Check : status === "failed" ? X : Copy;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-surface text-ink shadow-[0_3px_0_var(--ink)] transition-all hover:-translate-y-0.5 hover:bg-signal-wash active:translate-y-0.5 active:shadow-none"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/s/${token}`);
          setStatus("copied");
        } catch (error) {
          console.error("could not copy school sign-up link", error);
          setStatus("failed");
        }
      }}
    >
      <Icon aria-hidden className={`h-5 w-5 ${status === "failed" ? "text-danger" : ""}`} />
      <span aria-live="polite" className="sr-only">{status === "idle" ? "" : label}</span>
    </button>
  );
}
