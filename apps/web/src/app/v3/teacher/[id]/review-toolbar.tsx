"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { reviewToolbar } from "./creation-styles";

/** Keep review actions visible while the generated cards scroll. */
export function ReviewToolbar({
  children,
  floating = true,
  disabled = false,
  className = reviewToolbar,
}: {
  children: ReactNode;
  floating?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [dock, setDock] = useState<Element | null>(null);
  useEffect(() => {
    if (floating) setDock(document.querySelector("[data-review-dock]"));
  }, [floating]);
  const toolbar = (
    <fieldset
      aria-label="Review actions"
      disabled={disabled}
      className={className}
      data-review-toolbar
    >
      {children}
    </fieldset>
  );
  return floating && dock ? createPortal(toolbar, dock) : toolbar;
}
