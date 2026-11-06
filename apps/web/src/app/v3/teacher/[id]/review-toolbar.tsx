"use client";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Undo2 } from "lucide-react";
import { reviewDiscard, reviewResolve, reviewPrimary, reviewToolbar } from "./creation-styles";

const ProgressContext = createContext<{ progress: ReactNode; busy: boolean }>({ progress: null, busy: false });

export function ReviewToolbarProvider({ progress, busy, children }: { progress: ReactNode; busy: boolean; children: ReactNode }) {
  return <ProgressContext.Provider value={{ progress, busy }}>{children}</ProgressContext.Provider>;
}

/** Disabled stand-ins keep every stage's bar the same shape. */
export const DiscardPlaceholder = () => (
  <button type="button" aria-label="Discard" title="Discard" className={reviewDiscard} disabled><Undo2 aria-hidden size={16} /></button>
);
export const ResolvePlaceholder = () => (
  <button type="button" className={reviewResolve} data-review-resolve disabled><Sparkles aria-hidden size={16} />Resolve issues</button>
);

/** Preserve the review controls while the next pass is being generated. */
export function GenerationToolbar() {
  return <ReviewToolbar disabled primary={<button type="button" className={reviewPrimary}>Continue</button>} />;
}

/**
 * The bottom action bar. Slots render in visual (and tab) order:
 * Discard · primary · secondary · summary · progress · Resolve issues. An absent Discard or
 * Resolve slot renders a disabled stand-in; pass `null` to omit it entirely.
 */
export function ReviewToolbar({
  discard,
  primary,
  secondary,
  summary,
  resolve,
  disabled = false,
}: {
  discard?: ReactNode;
  primary?: ReactNode;
  /** Extra actions beside the primary one, e.g. the finished draft's Preview and editor links. */
  secondary?: ReactNode;
  summary?: ReactNode;
  resolve?: ReactNode;
  disabled?: boolean;
}) {
  const { progress, busy } = useContext(ProgressContext);
  const [dock, setDock] = useState<{ element: Element | null } | null>(null);
  // Before paint, so the bar never flashes inline before moving to the dock.
  useLayoutEffect(() => setDock({ element: document.querySelector("[data-review-dock]") }), []);
  if (!dock) return null;
  const toolbar = (
    <fieldset aria-label="Review actions" disabled={disabled || busy} className={reviewToolbar} data-review-toolbar>
      {discard === undefined ? <DiscardPlaceholder /> : discard}
      {primary}
      {secondary}
      {summary ? <div data-review-summary>{summary}</div> : null}
      {progress ? <div data-toolbar-progress className="min-w-0 flex-1">{progress}</div> : <div aria-hidden className="flex-1" />}
      {resolve === undefined ? <ResolvePlaceholder /> : resolve}
    </fieldset>
  );
  return dock.element ? createPortal(toolbar, dock.element) : toolbar;
}
