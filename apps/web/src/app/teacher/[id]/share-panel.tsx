"use client";

import { useState } from "react";

import { rotateShareToken } from "../actions";
import { ActionButton } from "@/components/action-form";
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
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/join/${token}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <code
          className={`flex-1 overflow-x-auto rounded-lg border border-black/15 px-3 py-2 text-xs dark:border-white/20 ${published ? "" : "opacity-50"}`}
        >
          /join/{token}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            track(ANALYTICS_EVENTS.shareLinkCopied);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-full border border-black/15 px-4 py-2 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {published ? null : (
        <p className="text-sm opacity-60">
          Students can’t use this link until the adventure is published.
        </p>
      )}
      <ActionButton
        action={rotateShareToken.bind(null, adventureId)}
        label="Rotate link"
        pendingLabel="Rotating…"
        variant="quiet"
      />
      <p className="text-sm opacity-60">
        Rotating invalidates the old link immediately. Students already playing keep
        their attempts.
      </p>
    </div>
  );
}
