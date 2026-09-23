"use client";

import { useEffect, useRef, useState } from "react";

import { rotateShareToken } from "../actions";
import { ActionButton } from "@/components/action-form";
import { button } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";

/**
 * The share link is only a way in once the adventure is published (P3), so an
 * unpublished adventure shows the link greyed out rather than hiding it: the
 * teacher can see what they are about to hand out.
 */
export function SharePanel({
  adventureId,
  token,
  published,
}: {
  adventureId: string;
  token: string;
  published: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/join/${token}`;

  useEffect(() => () => {
    if (revert.current !== null) clearTimeout(revert.current);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-stretch gap-2">
        <code
          className={`flex flex-1 items-center overflow-x-auto rounded-control border border-line bg-surface px-3 py-2 text-sm ${published ? "text-ink" : "text-muted line-through decoration-line-strong"}`}
        >
          /join/{token}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
            } catch {
              setCopyFailed(true);
              return;
            }
            track(ANALYTICS_EVENTS.shareLinkCopied);
            setCopyFailed(false);
            setCopied(true);
            revert.current = setTimeout(() => setCopied(false), 2000);
          }}
          className={button.quiet}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {copyFailed ? (
        <p className="text-sm text-muted">Couldn’t copy — select the link and copy it manually.</p>
      ) : null}
      {published ? null : (
        <p className="text-sm text-muted">Students can’t use this link until the adventure is published.</p>
      )}
      <div className="flex flex-col gap-2">
        <ActionButton action={rotateShareToken.bind(null, adventureId)} label="Replace the link" pendingLabel="Replacing…" variant="quiet" />
        <p className="max-w-[56ch] text-sm text-muted">
          The old link stops working immediately. Students already playing keep their attempts.
        </p>
      </div>
    </div>
  );
}
