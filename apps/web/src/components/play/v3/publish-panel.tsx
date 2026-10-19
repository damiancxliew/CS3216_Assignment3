"use client";

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useState, useTransition } from "react";

import {
  currentV3StudentLink,
  publishV3Adventure,
  unpublishV3Adventure,
} from "@/app/v3/teacher/[id]/publish-actions";
import { button, compactButton } from "@/components/ui";

export function V3PublishPanel({
  adventureId,
  published,
  blockedReason,
  compact = false,
  showHistory = true,
  version,
  publishedVersion,
  unpublishedChanges = false,
  disabled = false,
  onPublicationChange,
}: {
  adventureId: string;
  published: boolean;
  blockedReason?: string;
  compact?: boolean;
  showHistory?: boolean;
  onPublicationChange?: (published: boolean, version: number | null) => void;
  version?: number;
  publishedVersion?: number | null;
  unpublishedChanges?: boolean;
  disabled?: boolean;
}) {
  const styles = compact ? compactButton : button;
  const [isPublished, setPublished] = useState(published);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const [changes, setChanges] = useState(unpublishedChanges);
  const [pointer, setPointer] = useState(publishedVersion ?? null);
  const toggle = (publish = !isPublished) => {
    setMessage(null);
    startTransition(async () => {
      const expected =
        version === undefined
          ? undefined
          : { version, publishedVersion: pointer };
      const result = publish
        ? await publishV3Adventure(adventureId, expected)
        : await unpublishV3Adventure(adventureId, expected);
      if (result.ok) {
        setPublished(result.status === "published");
        setPointer(publish ? (version ?? null) : null);
        setChanges(false);
        onPublicationChange?.(publish, publish ? (version ?? null) : null);
      } else setMessage(result.message);
    });
  };

  const copy = async () => {
    try {
      const result = await currentV3StudentLink(adventureId);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const url = new URL(result.path, window.location.origin).href;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setMessage(`Copy this link: ${url}`);
      }
    } catch {
      setMessage("Could not load the student link. Try again.");
    }
  };

  const publishBlocked = disabled || pending || !!blockedReason;
  return (
    <section aria-label="Publication" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="text-sm">
          <p className="font-bold text-ink">
            {isPublished
              ? `Published${pointer ? ` · v${pointer}` : ""}`
              : "Draft"}
          </p>
          {isPublished && changes ? (
            <p className="mt-1 text-muted">Unpublished changes</p>
          ) : null}
        </div>
        {isPublished ? (
          <button
            type="button"
            onClick={() => toggle(false)}
            disabled={disabled || pending}
            className="text-sm text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            Unpublish
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!isPublished || changes ? (
          <span
            className="group/publish relative inline-flex rounded-full outline-offset-4"
            tabIndex={blockedReason ? 0 : undefined}
            role={blockedReason ? "group" : undefined}
            aria-label={blockedReason ? "Publish unavailable" : undefined}
            aria-describedby={
              blockedReason ? `publish-block-${adventureId}` : undefined
            }
          >
            <button
              type="button"
              onClick={() => toggle(true)}
              disabled={publishBlocked}
              aria-describedby={
                blockedReason ? `publish-block-${adventureId}` : undefined
              }
              className={styles.quiet + " disabled:pointer-events-none"}
            >
              {pending
                ? "Publishing…"
                : isPublished
                  ? "Publish changes"
                  : "Publish"}
            </button>
            {blockedReason ? (
              <span
                id={`publish-block-${adventureId}`}
                role="tooltip"
                className="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-56 max-w-[calc(100vw-2.5rem)] rounded-lg border border-danger/50 bg-danger-wash px-3 py-2 text-xs font-semibold leading-relaxed text-danger shadow-md group-hover/publish:visible group-focus-visible/publish:visible"
              >
                {blockedReason}
              </span>
            ) : null}
          </span>
        ) : null}
        {isPublished ? (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy link"}
            title={copied ? "Copied" : "Copy link"}
            className={styles.subtle + " !h-10 !w-10 !min-w-0 !p-0"}
          >
            {copied ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
          </button>
        ) : null}
      </div>
      {showHistory ? (
        <Link
          href={`/v3/teacher/${adventureId}/links`}
          className="inline-block text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          Version history
        </Link>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-ink">
          {message}
        </p>
      ) : null}
    </section>
  );
}
