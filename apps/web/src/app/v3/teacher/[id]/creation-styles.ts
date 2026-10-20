import { compactButton } from "@/components/ui";

export const reviewToolbar =
  "flex min-w-0 flex-nowrap items-center whitespace-nowrap gap-2 rounded-control border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur-sm [&>span]:min-w-0 [&>span]:truncate";
export const reviewPrimary = `${compactButton.primary} border-2 font-bold shadow-[0_3px_0_var(--ink)]`;

export const reviewEdit =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm font-semibold text-ink hover:border-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
