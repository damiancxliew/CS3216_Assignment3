"use client";

import { useState } from "react";

import { button } from "@/components/ui";

export function SchoolLinkCopy({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const path = `/s/${token}`;
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${path}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <code title={path} className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink">{path}</code>
      <button
        type="button"
        className={button.quiet}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setFailed(false);
          } catch (error) {
            console.error("could not copy school sign-up link", error);
            setCopied(false);
            setFailed(true);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      {failed ? <span className="text-sm text-danger">Couldn’t copy. Select and copy the link above.</span> : null}
    </div>
  );
}
