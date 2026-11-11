"use client";

import { useState } from "react";

import { button, Pending } from "@/components/ui";

/** The start route creates the session and attempt before redirecting, which takes seconds: show it, and block a second click. */
export function EnterLink({ href, label = "Enter the adventure" }: { href: string; label?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <a
      href={href}
      aria-disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (pending) { event.preventDefault(); return; }
        setPending(true);
      }}
      className={`${button.primary} min-h-12 px-6 text-base ${pending ? "pointer-events-none opacity-80" : ""}`}
    >
      {pending ? <Pending>Starting your adventure…</Pending> : label}
      {pending ? <span role="status" className="sr-only">Starting your adventure</span> : null}
    </a>
  );
}
