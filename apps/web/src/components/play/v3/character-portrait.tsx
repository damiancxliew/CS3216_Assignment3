"use client";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import { useState } from "react";

import { portraitUrl } from "@/lib/play/v3/portraits";

export function CharacterPortrait({
  name,
  portraitKey,
  portraitBase,
  selected,
  onSelect,
}: {
  name: string;
  portraitKey: string;
  portraitBase: PortraitBase;
  selected: boolean;
  onSelect: () => void;
}) {
  // Remember which URL failed, not just that one did: a stance change brings a new URL worth trying.
  const url = portraitUrl(portraitKey, portraitBase);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = url !== failedUrl ? url : null;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-16 items-center gap-3 rounded-xl border p-2 text-left transition ${
        selected ? "border-record bg-record-wash ring-2 ring-record/30" : "border-line bg-surface hover:bg-world-wash"
      }`}
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-line-strong bg-world-wash font-black text-world">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- optional generated stance portrait URL
          <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailedUrl(src)} />
        ) : initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold text-ink">{name}</span>
        <span className="block text-xs text-muted">{selected ? "Selected for conversation" : "Choose to speak"}</span>
      </span>
    </button>
  );
}
