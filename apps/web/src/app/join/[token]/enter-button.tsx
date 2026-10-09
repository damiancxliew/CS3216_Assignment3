"use client";

import { useFormStatus } from "react-dom";

import { button, Pending } from "@/components/ui";

/** Joining creates the attempt and reads the first state, which takes a few seconds: say so, and block a second click. */
export function EnterButton({
  label = "Enter the adventure",
  pendingLabel = "Opening the adventure…",
}: {
  label?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${button.primary} min-h-12 px-6 text-base`}>
      {pending ? <Pending>{pendingLabel}</Pending> : label}
    </button>
  );
}
