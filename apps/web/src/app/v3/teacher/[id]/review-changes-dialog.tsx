"use client";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import type { ReviewChatGroup } from "@/lib/v3/review-chat/types";
import { wordDiff, type DiffPart } from "@/lib/v3/review-chat/word-diff";

type PreviewItem = { label: string; before: string; after: string };

export function ReviewChangesDialog({
  open,
  onOpenChange,
  preview,
  groups,
  disabled,
  onApply,
  onDiscard,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  preview: PreviewItem[];
  groups?: ReviewChatGroup[];
  disabled: boolean;
  onApply(): void;
  onDiscard(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const displayGroups =
    groups ??
    preview.map((item, index) => ({
      label: item.label,
      edits: [],
      preview: [index],
    }));

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      closeButton.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="review-changes-title"
      className="m-auto hidden max-h-[85vh] w-[min(64rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-surface border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30 open:flex"
      onClose={() => onOpenChange(false)}
      onCancel={() => onOpenChange(false)}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 id="review-changes-title" className="font-semibold">
          Review suggested changes
        </h2>
        <span className="text-sm text-muted">· {displayGroups.length} fields</span>
        <button
          ref={closeButton}
          type="button"
          aria-label="Close review"
          title="Close review"
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          onClick={() => dialog.current?.close()}
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {displayGroups.map((group, groupIndex) => (
          <section key={`${group.label}-${groupIndex}`} className="space-y-3">
            <h3 className="text-sm font-semibold">{group.label}</h3>
            {group.preview.map((previewIndex) => {
              const item = preview[previewIndex];
              if (!item) return null;
              const parts = wordDiff(item.before, item.after);
              return (
                <div
                  key={`${previewIndex}-${item.label}`}
                  className="grid gap-3 md:grid-cols-2"
                >
                  <DiffPanel caption="Current" parts={parts} mode="current" />
                  <DiffPanel caption="Suggested" parts={parts} mode="suggested" />
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-control border border-line px-3 py-2 text-sm text-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          onClick={() => {
            onDiscard();
            dialog.current?.close();
          }}
        >
          <X size={16} aria-hidden />
          Discard
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-control bg-world px-3 py-2 text-sm text-on-accent hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-world disabled:opacity-50"
          disabled={disabled}
          onClick={() => {
            onApply();
            dialog.current?.close();
          }}
        >
          <Check size={16} aria-hidden />
          Apply
        </button>
      </footer>
    </dialog>
  );
}

function DiffPanel({
  caption,
  parts,
  mode,
}: {
  caption: string;
  parts: DiffPart[];
  mode: "current" | "suggested";
}) {
  return (
    <div className="rounded-control bg-sunken/60 p-3 whitespace-pre-wrap leading-relaxed">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {caption}
      </p>
      <p>
        {parts.map((part, index) => {
          if (mode === "current" && part.type === "added") return null;
          if (mode === "suggested" && part.type === "removed") return null;
          const className =
            part.type === "removed"
              ? "rounded-sm bg-danger-wash line-through decoration-danger/60"
              : part.type === "added"
                ? "rounded-sm bg-world-wash"
                : undefined;
          return (
            <span key={index} className={className}>
              {part.text}
            </span>
          );
        })}
      </p>
    </div>
  );
}
