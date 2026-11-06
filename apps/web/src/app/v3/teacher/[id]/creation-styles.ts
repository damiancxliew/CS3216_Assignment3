import { compactButton } from "@/components/ui";
import styles from "./creation-workspace.module.css";

export const reviewToolbar =
  "flex min-w-0 flex-nowrap items-center whitespace-nowrap gap-2 rounded-[1.75rem] border border-line-strong bg-surface/95 p-2 shadow-[0_2px_10px_rgb(0_0_0/0.10)] backdrop-blur-sm [&>span]:min-w-0 [&>span]:truncate";
export const reviewPrimary = `${compactButton.primary} ${styles.toolbarPrimary} font-bold`;

export const reviewEdit =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm font-semibold text-ink hover:border-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export const reviewIcon = `${styles.iconControl} border border-line-strong bg-transparent text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50`;
export const reviewDiscard = reviewIcon;
export const reviewResolve = `${compactButton.quiet} ${styles.toolbarResolve}`;
/** The briefing's Create sits in the primary slot but needs its full label. */
export const reviewCreate = `${compactButton.primary} ${styles.toolbarCreate} font-bold`;
