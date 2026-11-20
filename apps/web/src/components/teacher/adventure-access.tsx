"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";
import { setAdventurePublic } from "./adventure-access-actions";

export function AdventureAccess({ adventureId, kind, isPublic, compact = false }: {
  adventureId: string; kind: "v2" | "v3"; isPublic: boolean; compact?: boolean;
}) {
  const [value, setValue] = useState(isPublic);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div className={compact ? "space-y-1 text-sm" : "space-y-2 rounded-surface border border-line bg-surface p-4"}>
      <label className={compact ? "inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface pl-3.5 text-muted transition-colors focus-within:border-ink hover:border-line-strong" : "flex flex-wrap items-center gap-3 font-bold"} title={compact ? "Who can play" : undefined}>
        {compact ? <><Users className="size-4" aria-hidden /><span className="sr-only">Who can play</span></> : "Who can play"}
        <select className={compact ? "h-full cursor-pointer rounded-full bg-transparent pr-3 text-sm font-semibold text-ink focus:outline-none" : "rounded-control border border-line bg-paper px-3 py-2 text-sm font-normal"}
          value={value ? "public" : "school"} disabled={pending}
          onChange={event => {
            const next = event.target.value === "public";
            setError(false);
            startTransition(async () => {
              try {
                const result = await setAdventurePublic(adventureId, kind, next);
                if (result.ok) setValue(next);
                else setError(true);
              } catch { setError(true); }
            });
          }}>
          <option value="school">School members</option>
          <option value="public">Anyone with the link</option>
        </select>
      </label>
      {!compact ? <p className="text-sm text-muted">{value
        ? "Once published, anyone with the link can play without signing in. Guest progress is saved in this browser."
        : "Players must sign in and belong to your school."}</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">Could not save access. Try again.</p> : null}
      {pending ? <p role="status" className="text-sm text-muted">Saving…</p> : null}
    </div>
  );
}
