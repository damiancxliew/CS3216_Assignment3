"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

import { button } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";

type Network = "x" | "linkedin" | "whatsapp" | "telegram" | "copy_link";

/**
 * The debrief's share row. The URL only ever carries the two public titles —
 * adventure and ending — plus attribution params; attempt ids and share
 * tokens must never reach it.
 */
export function ShareButtons({ adventure, ending }: { adventure?: string; ending?: string }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = (network: Network) => {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const params = new URLSearchParams({
      title: ending ?? "",
      adventure: adventure ?? "",
      utm_source: network,
      utm_medium: "social",
      utm_campaign: "debrief_share",
    });
    return `${base}/share?${params.toString()}`;
  };

  const text = ending
    ? `I finished ${adventure ?? "a historical adventure"} — ${ending} on Historical Adventures`
    : `I finished ${adventure ?? "a historical adventure"} on Historical Adventures`;

  const targets: { network: Network; label: string; href: () => string }[] = [
    {
      network: "x",
      label: "X",
      href: () => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl("x"))}`,
    },
    {
      network: "linkedin",
      label: "LinkedIn",
      href: () => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl("linkedin"))}`,
    },
    {
      network: "whatsapp",
      label: "WhatsApp",
      href: () => `https://wa.me/?text=${encodeURIComponent(`${text} ${shareUrl("whatsapp")}`)}`,
    },
    {
      network: "telegram",
      label: "Telegram",
      href: () => `https://t.me/share/url?url=${encodeURIComponent(shareUrl("telegram"))}&text=${encodeURIComponent(text)}`,
    },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl("copy_link"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied (permissions, non-secure context); nothing to retry.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map(({ network, label, href }) => (
        <a
          key={network}
          href={href()}
          target="_blank"
          rel="noopener noreferrer"
          className={button.subtle}
          onClick={() => track(ANALYTICS_EVENTS.debriefShared, { network })}
        >
          {label}
        </a>
      ))}
      <button
        type="button"
        className={button.subtle}
        onClick={() => {
          track(ANALYTICS_EVENTS.debriefShared, { network: "copy_link" });
          void copy();
        }}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
