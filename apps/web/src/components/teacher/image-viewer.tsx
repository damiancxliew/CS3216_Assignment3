"use client";

import { Expand, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { button } from "@/components/ui";

/** Wraps an asset tile so clicking it opens the full image in a modal dialog. */
export function ImageViewer({
  src,
  title,
  caption,
  className = "",
  children,
}: {
  src: string;
  title: string;
  caption?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`group relative block cursor-zoom-in ${className}`}
        onClick={() => setOpen(true)}
        aria-label={`View ${title} larger`}
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition group-hover:bg-ink/40 group-hover:opacity-100 group-focus-visible:bg-ink/40 group-focus-visible:opacity-100"
        >
          <Expand size={20} className="text-paper" />
        </span>
      </button>
      {open ? <ViewerDialog src={src} title={title} caption={caption} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The dialog itself, mounted only while open so `showModal()` runs once. */
function ViewerDialog({
  src,
  title,
  caption,
  onClose,
}: {
  src: string;
  title: string;
  caption?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-w-4xl bg-transparent p-0 backdrop:bg-ink/70 backdrop:backdrop-blur-sm"
    >
      <div className="game-shadow flex flex-col items-start gap-3 rounded-surface border-2 border-ink bg-surface p-4">
        <div className="flex w-full items-center justify-between gap-3">
          <p className="font-serif text-lg leading-snug text-ink">{title}</p>
          <button type="button" autoFocus aria-label="Close image viewer" onClick={onClose} className={button.subtle}>
            <X size={18} aria-hidden />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated asset from storage */}
        <img src={src} alt={title} className="max-h-[70vh] w-auto max-w-full self-center rounded-control object-contain" />
        {caption ? <p className="text-sm text-muted">{caption}</p> : null}
        <a href={src} target="_blank" rel="noreferrer" className={button.subtle}>
          Open full size
        </a>
      </div>
    </dialog>
  );
}
