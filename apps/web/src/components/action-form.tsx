"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { button, ErrorText, Pending } from "@/components/ui";
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
    <form action={formAction} className={className ?? "flex flex-col gap-4"}>
      {children}
      <button type="submit" disabled={pending} className={`${button.primary} w-fit`}>
        {pending ? <Pending>{pendingLabel ?? "Working…"}</Pending> : submitLabel}
      </button>
      {state.error ? (
        <ErrorText>{state.error}</ErrorText>
      ) : state.notice ? (
        <p className="text-base text-muted">{state.notice}</p>
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

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button type="submit" disabled={pending} className={`${button[variant]} w-fit`}>
        {pending ? <Pending>{pendingLabel ?? "Working…"}</Pending> : label}
      </button>
      {state.error ? (
        <ErrorText>{state.error}</ErrorText>
      ) : state.notice ? (
        <p className="text-base text-muted">{state.notice}</p>
      ) : null}
    </form>
  );
}
