"use client";
import { useState, type ReactNode } from "react";
import { Pencil, Check } from "lucide-react";

export function ReviewCard({
  title,
  subtitle,
  preview,
  children,
}: {
  title: string;
  subtitle?: string;
  preview: ReactNode;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section
      className="min-w-0 rounded-surface border border-line bg-surface"
      aria-label={title}
      data-review-card
    >
      <header className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-bold text-ink">{title}</h3>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted">{subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-sm font-semibold text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {editing ? (
            <Check size={14} aria-hidden />
          ) : (
            <Pencil size={14} aria-hidden />
          )}
          {editing ? "Done" : "Edit"}
        </button>
      </header>
      <div className="min-w-0 px-4 pb-4 text-sm leading-relaxed sm:px-5">
        {editing ? children : preview}
      </div>
    </section>
  );
}
