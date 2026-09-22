"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { track } from "@/lib/analytics/posthog";
import type { AnalyticsEvent } from "@/lib/analytics/events";

/**
 * A form bound to a server action, with the two things every form in the
 * console needs: the error the action returned, and a pending state so a slow
 * write cannot be double-submitted.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  event,
  className,
  children,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  pendingLabel?: string;
  event?: AnalyticsEvent;
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: ActionResult, formData: FormData) => {
      const result = await action(prev, formData);
      if (event && !result.error) track(event);
      return result;
    },
    {} as ActionResult,
  );

  return (
    <form action={formAction} className={className ?? "flex flex-col gap-3"}>
      {children}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-fit items-center rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (pendingLabel ?? "Working…") : submitLabel}
      </button>
      {state.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : state.notice ? (
        <p className="text-sm opacity-70">{state.notice}</p>
      ) : null}
    </form>
  );
}

/** A single-button form for actions that take no input. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  event,
  variant = "primary",
}: {
  action: () => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  event?: AnalyticsEvent;
  variant?: "primary" | "quiet";
}) {
  const [state, formAction, pending] = useActionState(async () => {
    const result = await action();
    if (event && !result.error) track(event);
    return result;
  }, {} as ActionResult);

  const styles =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex w-fit items-center rounded-full px-5 py-2 text-sm font-medium transition disabled:opacity-50 ${styles}`}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </button>
      {state.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
    </form>
  );
}
