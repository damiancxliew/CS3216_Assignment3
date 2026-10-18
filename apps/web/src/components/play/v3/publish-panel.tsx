"use client";

import { Check, Link2 } from "lucide-react";
import { useState, useTransition } from "react";

import { publishV3Adventure, unpublishV3Adventure } from "@/app/v3/teacher/[id]/publish-actions";
import { button } from "@/components/ui";

export function V3PublishPanel({ adventureId, published, blockedReason }: { adventureId: string; published: boolean; blockedReason?: string }) {
  const [isPublished, setPublished] = useState(published);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const studentLink = () => `${window.location.origin}/v3/join/${encodeURIComponent(adventureId)}`;

  const toggle = () => {
    setMessage(null);
    startTransition(async () => {
      const result = isPublished
        ? await unpublishV3Adventure(adventureId)
        : await publishV3Adventure(adventureId);
      if (result.ok) setPublished(result.status === "published");
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
      <span className="text-sm font-bold text-ink">{isPublished ? "Published" : "Not published"}</span>
      <button type="button" onClick={toggle} disabled={pending || (!isPublished && !!blockedReason)} aria-describedby={!isPublished && blockedReason ? `publish-block-${adventureId}` : undefined} className={isPublished ? button.subtle : button.quiet}>
        {pending ? "Saving…" : isPublished ? "Unpublish" : "Publish"}
      </button>
      {isPublished ? (
        <button type="button" onClick={copy} className={button.subtle}>
          {copied ? <Check aria-hidden className="size-4" /> : <Link2 aria-hidden className="size-4" />}
          {copied ? "Copied" : "Copy student link"}
        </button>
      ) : null}
      {!isPublished && blockedReason ? <p id={`publish-block-${adventureId}`} className="w-full text-sm text-muted">{blockedReason}</p> : null}
      {message ? <p role="alert" className="w-full text-sm text-ink">{message}</p> : null}
    </div>
  );
}
