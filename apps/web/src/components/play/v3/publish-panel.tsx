"use client";

import { Check, Link2 } from "lucide-react";
import { useState, useTransition } from "react";

import {
  publishV3Adventure,
  unpublishV3Adventure,
} from "@/app/v3/teacher/[id]/publish-actions";
import { button, compactButton } from "@/components/ui";

export function V3PublishPanel({
  adventureId,
  published,
  blockedReason,
  compact = false,
  version, publishedVersion, unpublishedChanges = false, disabled = false, onPublicationChange,
}: {
  adventureId: string;
  published: boolean;
  blockedReason?: string;
  compact?: boolean;
  onPublicationChange?: (published: boolean, version: number | null) => void;
  version?: number; publishedVersion?: number | null; unpublishedChanges?: boolean; disabled?: boolean;
}) {
  const styles = compact ? compactButton : button;
  const [isPublished, setPublished] = useState(published);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const studentLink = () =>
    `${window.location.origin}/v3/join/${encodeURIComponent(adventureId)}`;

  const [changes, setChanges] = useState(unpublishedChanges);
  const [pointer, setPointer] = useState(publishedVersion ?? null);
  const toggle = (publish = !isPublished) => {
    setMessage(null);
    startTransition(async () => {
      const expected = version === undefined ? undefined : { version, publishedVersion: pointer };
      const result = publish
        ? await publishV3Adventure(adventureId, expected)
        : await unpublishV3Adventure(adventureId, expected);
      if (result.ok) { setPublished(result.status === "published"); setPointer(publish ? version ?? null : null); setChanges(false); onPublicationChange?.(publish, publish ? version ?? null : null); }
      else setMessage(result.message);
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(studentLink());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage(`Copy this link: ${studentLink()}`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isPublished ? (
        <span className="text-sm font-bold text-ink">Published</span>
      ) : null}
      {isPublished && changes ? <>
        <span className="text-sm">Unpublished changes</span>
        <button type="button" className={styles.quiet} disabled={disabled || pending || !!blockedReason} onClick={() => toggle(true)}>Publish changes</button>
        {blockedReason ? <p className="text-sm" role="status">{blockedReason}</p> : null}
      </> : null}
      <span
        className="group/publish relative inline-flex rounded-full outline-offset-4"
        tabIndex={!isPublished && blockedReason ? 0 : undefined}
        role={!isPublished && blockedReason ? "group" : undefined}
        aria-label={
          !isPublished && blockedReason ? "Publish unavailable" : undefined
        }
        aria-describedby={
          !isPublished && blockedReason
            ? `publish-block-${adventureId}`
            : undefined
        }
      >
        <button
          type="button"
          onClick={() => toggle()}
          disabled={disabled || pending || (!isPublished && !!blockedReason)}
          aria-describedby={
            !isPublished && blockedReason
              ? `publish-block-${adventureId}`
              : undefined
          }
          className={
            (isPublished ? styles.subtle : styles.quiet) +
            " disabled:pointer-events-none"
          }
        >
          {pending ? "Saving…" : isPublished ? "Unpublish" : "Publish"}
        </button>
        {!isPublished && blockedReason ? (
          <span
            id={`publish-block-${adventureId}`}
            role="tooltip"
            className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-56 max-w-[calc(100vw-2.5rem)] rounded-lg border border-danger/50 bg-danger-wash px-3 py-2 text-xs font-semibold leading-relaxed text-danger shadow-md group-hover/publish:visible group-focus-visible/publish:visible sm:left-auto sm:right-0"
          >
            {blockedReason}
          </span>
        ) : null}
      </span>
      {isPublished ? (
        <button type="button" onClick={copy} className={styles.subtle}>
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Link2 aria-hidden className="size-4" />
          )}
          {copied ? "Copied" : "Copy student link"}
        </button>
      ) : null}
      {message ? (
        <p role="alert" className="w-full text-sm text-ink">
          {message}
        </p>
      ) : null}
    </div>
  );
}
