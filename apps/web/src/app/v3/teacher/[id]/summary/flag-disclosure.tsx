"use client";

import { useId, useState, type ReactNode } from "react";

export function FlagDisclosure({
  title,
  badge,
  meta,
  defaultOpen,
  children,
}: {
  title: ReactNode;
  badge: ReactNode;
  meta: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer flex-col gap-2 px-4 py-4 text-left sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="flex min-w-0 items-center gap-3">
          {title}
          <span
            aria-hidden={open}
            className={`transition-opacity duration-200 ${open ? "opacity-0" : "opacity-100"}`}
          >
            {badge}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
          {meta}
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`size-4 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M5 7.5l5 5 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div
        id={panelId}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
